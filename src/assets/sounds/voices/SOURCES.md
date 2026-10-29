# Generated voice recordings

These are downloaded audio files, not a runtime service. No API key, account or
backend is needed to play downloaded recordings.

Voice acting defaults to Off and is only available after Developer mode is
unlocked. A saved developer On preference cannot enable voices during normal
startup.

## Recordings

[manifest.json](./manifest.json) lists the downloaded clips, exact dialogue,
source locations, durations and voice references. Reused dialogue shares one
recording. Dynamic counters are shown in subtitles but are not read aloud.
Brondon's dialogue is voiced, as are the other nine characters.

The performances are generated offline with
[Kyutai Pocket TTS](https://github.com/kyutai-labs/pocket-tts), model `b6369a24`,
using the free [Pocket TTS demo](https://huggingface.co/spaces/D3vShoaib/pocket-tts).
The [model weights](https://huggingface.co/kyutai/pocket-tts) are licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); the inference code is
MIT-licensed. Pocket TTS conditions neural speech on a reference performance.
It does not offer a separate emotion-instruction parameter.

Prime's reference and first production line were originally generated with
[Qwen3-TTS VoiceDesign and Base, 1.7B](https://huggingface.co/spaces/Qwen/Qwen3-TTS).
The [Qwen model license is Apache-2.0](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign/blob/main/LICENSE).
Prime is an original AI-designed male voice, not an imitation of a named actor.

## Cast and reference attribution

The other nine male voice references come from the
[CSTR VCTK Corpus, version 0.92](https://datashare.ed.ac.uk/handle/10283/3443)
by Junichi Yamagishi, Christophe Veaux and Kirsten MacDonald (2019), distributed
under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The samples are from [Kyutai's voice catalogue](https://huggingface.co/kyutai/tts-voices),
using the enhanced sentence-23 microphone-1 recordings. Kyutai credits
[ai-coustics](https://ai-coustics.com/) for the enhancement.
These are synthetic fictional performances; no endorsement by the dataset
speakers or providers is implied.

| Character | Reference |
|---|---|
| Prime | Original Qwen3-TTS designed male voice |
| Brondon | VCTK `p226_023_enhanced.wav` |
| Branden | VCTK `p227_023_enhanced.wav` |
| Brendan | VCTK `p232_023_enhanced.wav` |
| Donus | VCTK `p237_023_enhanced.wav` |
| Caleb | VCTK `p243_023_enhanced.wav` |
| Husain | VCTK `p254_023_enhanced.wav` |
| André | VCTK `p256_023_enhanced.wav` |
| Sibusiso | VCTK `p258_023_enhanced.wav` |
| Sohrab | VCTK `p264_023_enhanced.wav` |
| Sudoers 5 | Five separately generated student performances, mixed together |

Reference download URLs follow
`https://huggingface.co/kyutai/tts-voices/resolve/main/vctk/<reference>`.
No noncommercial-only Expresso or EARS references are used.

## Direction and modifications

- Prime: clear, high-pitched male, calm and nonchalant even during danger.
  Generation uses the neutral reference, low sampling temperature and periods
  rather than shouted exclamation marks. A 10% pitch lift, clarity EQ and light
  80 Hz modulation blended with the clean performance add the robotic character.
- Donus: a 14% pitch reduction with duration compensation.
- Group lines: five distinct recordings, word-aligned with pitch-preserving
  time stretching, distributed across stereo with small onset offsets; not one
  duplicated voice or an echo.
- All clips: high-pass filtering, -18 LUFS normalization, -2 dBTP ceiling,
  24 kHz Vorbis encoding. These are modified synthetic derivatives of the
  credited references.
- Fixed cinematic cue windows can speed up playback with pitch preservation;
  prologue and pickup dialogue allow enough time for the recording.

The generation website is a production tool only. The game loads the bundled
Ogg recordings without contacting any voice provider.
