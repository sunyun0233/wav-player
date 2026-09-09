import wave, struct, math
sr=44100
def wav(name,freq,dur,amp=0.4):
    frames=int(sr*dur); buf=bytearray()
    for i in range(frames):
        t=i/sr; v=amp*math.sin(2*math.pi*freq*t); v*= (0.7+0.3*math.sin(2*math.pi*1.1*t))
        buf += struct.pack('<hh', int(v*32767), int(v*32767))
    with wave.open(name,'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(bytes(buf))
wav('samples/album/04_hush.wav', 294, 3.0)
wav('samples/album/deep/05_glow.wav', 349, 3.0)
print('ok')
