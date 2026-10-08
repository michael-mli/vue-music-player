// Private, fixed-memory stereo decoder. This translation unit has no audio or
// network access. Only a later, separately authorised renderer can emit PCM.
#include <opus.h>
#include <stdint.h>
#include <string.h>

#define MAX_PACKET 65536
#define MAX_FRAMES 5760
static union { double alignment; unsigned char bytes[65536]; } decoder_storage;
static unsigned char input[MAX_PACKET];
static float output[MAX_FRAMES * 2];
static OpusDecoder *decoder;

int ktv_opus_version(void) { return 10601; }
int ktv_opus_input(void) { return (int)(uintptr_t)input; }
int ktv_opus_output(void) { return (int)(uintptr_t)output; }
int ktv_opus_open(void) {
  if (decoder || opus_decoder_get_size(2) > (int)sizeof(decoder_storage)) return -1;
  decoder = (OpusDecoder *)decoder_storage.bytes;
  int result = opus_decoder_init(decoder, 48000, 2);
  if (result) decoder = 0;
  return result;
}
int ktv_opus_decode(int length) {
  if (!decoder || length < 1 || length > MAX_PACKET) return OPUS_BAD_ARG;
  return opus_decode_float(decoder, input, length, output, MAX_FRAMES, 0);
}
int ktv_opus_conceal(int frames) {
  if (!decoder || frames < 120 || frames > MAX_FRAMES || frames % 120) return OPUS_BAD_ARG;
  return opus_decode_float(decoder, 0, 0, output, frames, 0);
}
void ktv_opus_close(void) {
  decoder = 0;
  memset(decoder_storage.bytes, 0, sizeof(decoder_storage));
  memset(input, 0, sizeof(input));
  memset(output, 0, sizeof(output));
}
