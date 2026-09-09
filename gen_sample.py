import wave, math, struct, random
sr = 44100
dur = 18.0
frames = int(sr*dur)
left = bytearray()
# segments: (start_s, end_s, base_freq, amp)
segs = [
 (0.0, 2.0, 220, .35),
 (2.0, 4.0, 330, .5),
 (4.0, 6.5, 262, .28),
 (6.5, 9.0, 392, .6),
 (9.0, 12.0, 294, .4),
 (12.0, 14.5, 440, .55),
 (14.5, 18.0, 247, .3),
]
r = random.Random(7)
for i in range(frames):
    t = i/sr
    f = 220; a = .2
    for s,e,fq,av in segs:
        if s <= t < e:
            f = fq; a = av; break
    # simple envelope attack/decay per segment for a natural look
    val = a * math.sin(2*math.pi*f*t)
    # add a secondary harmonic
    val += (a*0.35) * math.sin(2*math.pi*f*2*t + 0.3)
    # slight tremolo
    val *= (0.75 + 0.25*math.sin(2*math.pi*0.9*t))
    import math as m
    val = max(-1.0, min(1.0, val))
    sample = int(val*32767)
    left += struct.pack('<hh', sample, sample)
with wave.open('samples/sample.wav','wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr)
    w.writeframes(bytes(left))
print('written samples/sample.wav', len(left)//4, 'frames')
