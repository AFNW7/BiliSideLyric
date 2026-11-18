import json
import math
import wave
from pathlib import Path

import numpy as np


def save_wav(path, samples, rate):
    with wave.open(str(path), 'wb') as output:
        output.setnchannels(samples.shape[1] if samples.ndim > 1 else 1)
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes((np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes())


def main():
    root = Path(__file__).resolve().parent
    story = json.loads((root / 'storyboard.json').read_text(encoding='utf-8'))
    output = root / 'output'
    output.mkdir(exist_ok=True)
    rate = 48000
    duration = story['duration']
    audio = np.zeros((duration * rate, 2), dtype=np.float64)
    chords = [[50, 57, 62, 65], [46, 53, 58, 62], [53, 60, 65, 69], [48, 55, 60, 64]]
    beat = 60 / 116
    for phrase in range(math.ceil(duration / (beat * 8))):
        chord = chords[phrase % len(chords)]
        for note in chord:
            start = phrase * beat * 8
            length = min(beat * 8 + 1, duration - start)
            if length <= 0:
                continue
            clock = np.arange(int(length * rate)) / rate
            frequency = 440 * 2 ** ((note - 69) / 12)
            envelope = np.minimum(clock / 1.2, 1) * np.minimum((length - clock) / 1.6, 1)
            tone = (np.sin(2 * np.pi * frequency * clock) + .25 * np.sin(2 * np.pi * frequency * 2.002 * clock)) * envelope * .018
            position = int(start * rate)
            audio[position:position + len(tone), 0] += tone
            audio[position:position + len(tone), 1] += tone * .94
    for step in range(math.ceil(duration / (beat / 2))):
        start = step * beat / 2
        length = min(1.5, duration - start)
        clock = np.arange(int(length * rate)) / rate
        chord = chords[int(start / (beat * 8)) % len(chords)]
        note = chord[[0, 2, 1, 3, 2, 1, 3, 2][step % 8]] + 12
        frequency = 440 * 2 ** ((note - 69) / 12)
        tone = np.sin(2 * np.pi * frequency * clock) * np.exp(-clock * 4.2) * np.minimum(clock / .015, 1) * .034
        position = int(start * rate)
        pan = .35 if step % 2 else .65
        audio[position:position + len(tone), 0] += tone * pan
        audio[position:position + len(tone), 1] += tone * (1 - pan)
    for scene_index, scene in enumerate(story['scenes']):
        path = output / 'voice' / f'scene-{scene_index:02d}.wav'
        with wave.open(str(path), 'rb') as source:
            voice_rate = source.getframerate()
            channels = source.getnchannels()
            assert source.getsampwidth() == 2
            samples = np.frombuffer(source.readframes(source.getnframes()), dtype='<i2').astype(np.float64) / 32768
        if channels > 1:
            samples = samples.reshape(-1, channels).mean(axis=1)
        voice_duration = len(samples) / voice_rate
        available = scene['end'] - scene['start'] - .6
        assert voice_duration <= available, f"{scene['name']}配音超时，请精简文案"
        voice = np.interp(np.arange(round(voice_duration * rate)) / rate, np.arange(len(samples)) / voice_rate, samples)
        # 保留大肥鱼原始音高与语速，只重采样至混音采样率。
        voice /= max(np.max(np.abs(voice)), .01)
        start = round((scene['start'] + .35) * rate)
        audio[start:start + len(voice)] *= .3
        audio[start:start + len(voice)] += voice[:, None] * .42
        print(f"Scene {scene_index + 1}: voice {voice_duration:.2f}s / window {available:.2f}s")
    clock = np.arange(len(audio)) / rate
    audio *= (np.minimum(clock / .15, 1) * np.minimum((duration - clock) / .5, 1))[:, None]
    peak = np.max(np.abs(audio))
    if peak > .92:
        audio *= .92 / peak
    save_wav(output / 'soundtrack.wav', audio, rate)
    print(f"Soundtrack: {duration}s, {rate}Hz stereo; original music + bibibobo fish voice")


if __name__ == '__main__':
    main()
