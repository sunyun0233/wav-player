import wave, struct, math, os
sr = 44100
def wav(name, freq, dur, amp=0.4):
    frames = int(sr*dur)
    buf = bytearray()
    for i in range(frames):
        t = i/sr
        v = amp * math.sin(2*math.pi*freq*t)
        v *= (0.7 + 0.3*math.sin(2*math.pi*1.2*t))
        buf += struct.pack('<hh', int(v*32767), int(v*32767))
    with wave.open(name,'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(bytes(buf))
wav('samples/album/01_signal.wav', 330, 3.0)
wav('samples/album/02_tide.wav', 262, 3.0)
wav('samples/album/03_sleep.wav', 196, 3.0)
print('wavs done')
