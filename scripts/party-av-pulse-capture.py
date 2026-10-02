"""Owned PulseAudio monitor fixture: emits timing/marker JSON, never raw audio."""
import array
import ctypes
import ctypes.util
import json
import math
import os
import sys
import time
from collections import deque

RATE = 44100
WINDOW = 1024
FRAGMENT = 441


class Detector:
    def __init__(self):
        self.samples = deque(maxlen=WINDOW)
        self.state = None
        self.candidate = None
        self.consecutive = 0
        self.edge_time = 0
        self.last_magnitudes = None

    def feed(self, values, end_ms):
        self.samples.extend(values)
        if len(self.samples) < WINDOW:
            return None

        def magnitude(frequency):
            coefficient = 2 * math.cos(2 * math.pi * frequency / RATE)
            previous = before = 0
            for sample in self.samples:
                value = sample + coefficient * previous - before
                before, previous = previous, value
            return 2 * math.sqrt(max(0, previous * previous + before * before - coefficient * previous * before)) / WINDOW

        on, off = magnitude(440), magnitude(660)
        self.last_magnitudes = {'onAmplitude': on, 'offAmplitude': off}
        total = on + off
        if total < .015:
            self.candidate = None
            self.consecutive = 0
            return None
        ratio = on / total
        next_state = True if ratio > .65 else False if ratio < .35 else None
        if next_state is None or next_state == self.state:
            self.candidate = None
            self.consecutive = 0
            return None
        if next_state != self.candidate:
            self.candidate = next_state
            self.consecutive = 0
            self.edge_time = end_ms - WINDOW * 500 / RATE
        self.consecutive += 1
        if self.consecutive < 2:
            return None
        result = {"on": next_state, "time": self.edge_time, "initial": self.state is None, "analysisWindowMs": WINDOW * 1000 / RATE}
        self.state = next_state
        self.candidate = None
        self.consecutive = 0
        return result


class FragmentDetector:
    """Keep DSP hop timing independent of Pulse's variable fragment boundaries."""
    def __init__(self):
        self.detector = Detector()
        self.pending = array.array('f')

    @property
    def last_magnitudes(self):
        return self.detector.last_magnitudes

    def feed(self, samples, first_ms):
        offset, edges = 0, []
        while offset < len(samples):
            take = min(FRAGMENT - len(self.pending), len(samples) - offset)
            self.pending.extend(samples[offset:offset + take])
            offset += take
            if len(self.pending) < FRAGMENT:
                continue
            edge = self.detector.feed(self.pending, first_ms + offset * 1000 / RATE)
            self.pending = array.array('f')
            if edge:
                edges.append(edge)
        return edges


def capture():
    server = os.environ.get('PULSE_SERVER', '')
    if not server.startswith('unix:/tmp/ktv-room-browser.'):
        raise RuntimeError('Capture requires an owned private PulseAudio socket')

    class SampleSpec(ctypes.Structure):
        _fields_ = [('format', ctypes.c_int), ('rate', ctypes.c_uint32), ('channels', ctypes.c_uint8)]

    class BufferAttr(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint32) for name in ['maxlength', 'tlength', 'prebuf', 'minreq', 'fragsize']]

    lib = ctypes.CDLL(ctypes.util.find_library('pulse'))
    pointer = ctypes.c_void_p
    def bind(name, result, arguments):
        function = getattr(lib, name)
        function.restype, function.argtypes = result, arguments
        return function

    bind('pa_mainloop_new', pointer, [])
    bind('pa_mainloop_get_api', pointer, [pointer])
    bind('pa_mainloop_iterate', ctypes.c_int, [pointer, ctypes.c_int, ctypes.POINTER(ctypes.c_int)])
    bind('pa_mainloop_free', None, [pointer])
    bind('pa_context_new', pointer, [pointer, ctypes.c_char_p])
    bind('pa_context_connect', ctypes.c_int, [pointer, ctypes.c_char_p, ctypes.c_int, pointer])
    bind('pa_context_get_state', ctypes.c_int, [pointer])
    bind('pa_context_disconnect', None, [pointer])
    bind('pa_context_unref', None, [pointer])
    bind('pa_stream_new', pointer, [pointer, ctypes.c_char_p, ctypes.POINTER(SampleSpec), pointer])
    bind('pa_stream_connect_record', ctypes.c_int, [pointer, ctypes.c_char_p, ctypes.POINTER(BufferAttr), ctypes.c_int])
    bind('pa_stream_get_state', ctypes.c_int, [pointer])
    bind('pa_stream_readable_size', ctypes.c_size_t, [pointer])
    bind('pa_stream_peek', ctypes.c_int, [pointer, ctypes.POINTER(pointer), ctypes.POINTER(ctypes.c_size_t)])
    bind('pa_stream_drop', ctypes.c_int, [pointer])
    bind('pa_stream_get_latency', ctypes.c_int, [pointer, ctypes.POINTER(ctypes.c_uint64), ctypes.POINTER(ctypes.c_int)])
    bind('pa_stream_disconnect', ctypes.c_int, [pointer])
    bind('pa_stream_unref', None, [pointer])
    loop, context, stream = lib.pa_mainloop_new(), None, None
    if not loop:
        raise RuntimeError('Private monitor mainloop unavailable')

    def iterate():
        if lib.pa_mainloop_iterate(loop, 0, None) < 0:
            raise RuntimeError('Private monitor mainloop failed')

    def wait_ready(handle, state, ready, failed):
        deadline = time.monotonic() + 5
        while state(handle) != ready:
            if state(handle) in failed or time.monotonic() > deadline:
                raise RuntimeError('Private monitor connection failed')
            iterate()
            time.sleep(.001)

    try:
        context = lib.pa_context_new(lib.pa_mainloop_get_api(loop), b'ktv-owned-av-monitor')
        if not context or lib.pa_context_connect(context, server.encode(), 0, None) < 0:
            raise RuntimeError('Private output server unavailable')
        wait_ready(context, lib.pa_context_get_state, 4, [5, 6])
        spec = SampleSpec(5, RATE, 1)  # Public FLOAT32LE enum.
        attr = BufferAttr(0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, FRAGMENT * 4)
        stream = lib.pa_stream_new(context, b'marker-observer', ctypes.byref(spec), None)
        # INTERPOLATE_TIMING | AUTO_TIMING_UPDATE | ADJUST_LATENCY.
        if not stream or lib.pa_stream_connect_record(stream, b'ktv_av.monitor', ctypes.byref(attr), 0x200a) < 0:
            raise RuntimeError('Private output monitor unavailable')
        wait_ready(stream, lib.pa_stream_get_state, 2, [3, 4])
        print(json.dumps({'ready': True, 'rate': RATE, 'fragmentFrames': FRAGMENT,
                          'windowFrames': WINDOW, 'signedMonitorLatency': True}), flush=True)
        detector = FragmentDetector()
        started, events, last_heartbeat = time.monotonic(), 0, 0
        timing_deadline = started + 5
        while time.monotonic() - started < 880:
            iterate()
            if lib.pa_context_get_state(context) != 4 or lib.pa_stream_get_state(stream) != 2:
                raise RuntimeError('Private output monitor disconnected')
            available = lib.pa_stream_readable_size(stream)
            if available == ctypes.c_size_t(-1).value:
                raise RuntimeError('Private output monitor read failed')
            if not available:
                time.sleep(.001)
                continue
            data, size = pointer(), ctypes.c_size_t()
            if lib.pa_stream_peek(stream, ctypes.byref(data), ctypes.byref(size)) < 0:
                raise RuntimeError('Private output monitor peek failed')
            if not size.value:
                continue
            if size.value % 4 or size.value > 4 * 1024 * 1024:
                raise RuntimeError('Private monitor fragment exceeds bounds')
            latency, negative = ctypes.c_uint64(), ctypes.c_int()
            before = time.time() * 1000
            timed = lib.pa_stream_get_latency(stream, ctypes.byref(latency), ctypes.byref(negative))
            after = time.time() * 1000
            if timed < 0:
                if time.monotonic() > timing_deadline:
                    raise RuntimeError('Private output monitor timing unavailable')
                time.sleep(.001)
                continue
            timing_deadline = time.monotonic() + 5
            # Timing refers to the oldest unread sample before drop(). Monitor
            # samples can precede their sink presentation: retain the sign.
            capture_ms = latency.value / 1000 * (-1 if negative.value else 1)
            first_ms = (before + after) / 2 - capture_ms
            samples = array.array('f')
            samples.frombytes(ctypes.string_at(data, size.value) if data else bytes(size.value))
            if sys.byteorder != 'little':
                samples.byteswap()
            if lib.pa_stream_drop(stream) < 0:
                raise RuntimeError('Private monitor consume failed')
            for edge in detector.feed(samples, first_ms):
                edge.update({'captureQueueMs': capture_ms, 'captureCallMs': after - before,
                             'fragmentMs': FRAGMENT * 1000 / RATE})
                print(json.dumps(edge), flush=True)
                events += 1
                if events > 256:
                    raise RuntimeError('Output marker evidence limit')
            if time.monotonic() - last_heartbeat >= 1:
                print(json.dumps({'captureHeartbeat': True, 'time': after, 'captureQueueMs': capture_ms,
                                  **(detector.last_magnitudes or {})}), flush=True)
                last_heartbeat = time.monotonic()
    finally:
        if stream:
            lib.pa_stream_disconnect(stream)
            lib.pa_stream_unref(stream)
        if context:
            lib.pa_context_disconnect(context)
            lib.pa_context_unref(context)
        lib.pa_mainloop_free(loop)


if __name__ == '__main__':
    capture()
