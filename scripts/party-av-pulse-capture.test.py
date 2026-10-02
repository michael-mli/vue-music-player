import importlib.util
import math
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('ktv_capture', pathlib.Path(__file__).with_name('party-av-pulse-capture.py'))
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


class OutputDetectorTests(unittest.TestCase):
    def test_pcm_marker_edges(self):
        detector = capture.Detector()
        edges = []
        for start in range(0, capture.RATE * 4, capture.FRAGMENT):
            values = []
            for frame in range(start, start + capture.FRAGMENT):
                seconds = frame / capture.RATE
                frequency = 660 if int(seconds) % 2 else 440
                values.append(.06 * math.sin(2 * math.pi * frequency * seconds) + .09 * math.sin(2 * math.pi * 880 * seconds))
            edge = detector.feed(values, (start + capture.FRAGMENT) * 1000 / capture.RATE)
            if edge:
                edges.append(edge)
        self.assertEqual(len(edges), 4)
        self.assertTrue(edges[0]['initial'])
        for index, edge in enumerate(edges[1:], 1):
            self.assertEqual(edge['on'], index % 2 == 0)
            self.assertFalse(edge['initial'])
            self.assertLess(abs(edge['time'] - index * 1000), 20)

    def test_fragment_boundaries_do_not_change_marker_timing(self):
        values = [.06 * math.sin(2 * math.pi * (440 if int(frame / capture.RATE) % 2 == 0 else 660) * frame / capture.RATE)
                  for frame in range(capture.RATE * 3)]
        results = []
        for sizes in [[capture.FRAGMENT], [1, 7, 341, 440, 29, 1200]]:
            detector, edges, offset, part = capture.FragmentDetector(), [], 0, 0
            while offset < len(values):
                size = sizes[part % len(sizes)]
                chunk = values[offset:offset + size]
                edges.extend(detector.feed(chunk, 5000 + offset * 1000 / capture.RATE))
                offset += len(chunk)
                part += 1
            results.append(edges)
        self.assertEqual(len(results[0]), 3)
        self.assertEqual([edge['on'] for edge in results[0]], [True, False, True])
        for expected, actual in zip(*results):
            self.assertAlmostEqual(expected['time'], actual['time'], places=6)
        for index, edge in enumerate(results[0][1:], 1):
            self.assertLess(abs(edge['time'] - (5000 + index * 1000)), 20)

    def test_silence_does_not_invent_edges(self):
        detector = capture.Detector()
        edges = []
        for index in range(200):
            samples = [0 if 60 <= index < 80 else .06 * math.sin(2 * math.pi * 440 * (index * capture.FRAGMENT + offset) / capture.RATE)
                       for offset in range(capture.FRAGMENT)]
            edge = detector.feed(samples, (index + 1) * 10)
            if edge:
                edges.append(edge)
        self.assertEqual(len(edges), 1)
        self.assertTrue(edges[0]['on'])

    def test_activity_measures_quiet_start_stop_and_reactivation(self):
        # A non-marker tone proves silence detection does not depend on 440/660.
        values = [0 if int(frame / capture.RATE) % 2 == 0 else
                  .06 * math.sin(2 * math.pi * 900 * frame / capture.RATE)
                  for frame in range(capture.RATE * 5)]
        results = []
        for sizes in [[capture.FRAGMENT], [1, 7, 341, 440, 29, 1200]]:
            detector, edges, offset, part = capture.FragmentDetector(activity=True), [], 0, 0
            while offset < len(values):
                chunk = values[offset:offset + sizes[part % len(sizes)]]
                edges.extend(detector.feed(chunk, 5000 + offset * 1000 / capture.RATE))
                offset += len(chunk)
                part += 1
            results.append([edge for edge in edges if 'audible' in edge])
        self.assertEqual([edge['audible'] for edge in results[0]], [False, True, False, True, False])
        self.assertTrue(results[0][0]['initial'])
        for expected, actual in zip(*results):
            self.assertAlmostEqual(expected['time'], actual['time'], places=6)
        for index, edge in enumerate(results[0][1:], 1):
            self.assertFalse(edge['initial'])
            self.assertLess(abs(edge['time'] - (5000 + index * 1000)), 35)
        self.assertEqual(detector.last_magnitudes['rmsAmplitude'], 0)

    def test_activity_is_opt_in_and_does_not_change_frequency_edges(self):
        values = [.06 * math.sin(2 * math.pi * 440 * frame / capture.RATE)
                  for frame in range(capture.RATE)]
        normal = capture.FragmentDetector().feed(values, 5000)
        observed = capture.FragmentDetector(activity=True).feed(values, 5000)
        self.assertEqual(normal, [edge for edge in observed if 'on' in edge])
        self.assertEqual(len([edge for edge in observed if edge.get('audible')]), 1)


if __name__ == '__main__':
    unittest.main()
