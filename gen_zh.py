import wave, struct, math
sr=44100; frames=int(sr*2); buf=bytearray()
for i in range(frames):
    t=i/sr; v=0.4*math.sin(2*math.pi*220*t); buf+=struct.pack('<hh',int(v*32767),int(v*32767))
with wave.open('samples/zh/01.和我分手后悔了？.wav','wb') as w: w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(bytes(buf))
print('ok')
