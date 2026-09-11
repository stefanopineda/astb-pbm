# ASTB-PBM practice console

High-fidelity **local** trainer for the flight-simulator portion of the ASTB-E (Performance Based Measures): X-52 stick tracking, throttle tracking, and dichotic left/right ear cues.

This is practice software. It is not the official Navy test and does not emit official PFAR / FOFAR scores.

## Quick start

1. Plug in the X-52 (USB-A → USB-C). Allow the accessory if macOS prompts.
2. Put on the split headset.
3. From this folder:

```bash
./serve.sh
```

4. Open **http://127.0.0.1:8765** in Chrome.
5. **Click anywhere on this page first**, then start with **Hardware bench**. Chrome only exposes gamepads after a user click (browser security). Without that click, the HOTAS pill says "not seen" even when the stick is plugged in and registered at the OS. After the click, the bench maps the stick, throttle, trigger, thumb button, and proves each ear is isolated.

## Hardware bench

**Click anywhere on this page first.** Chrome only exposes gamepads after a user click (browser security). Without that click, the HOTAS pill says "not seen" even when the X-52 is plugged in and already registered at the OS. A headless or no-click check will miss a stick that macOS can already see.

Do not skip this screen. After the click, walk the guided steps: headset as the output, left/right tones, spoken tokens, stick, throttle, trigger, and thumb. Save the mapping before scored runs.

## What you can run

| Module | Hardware | What it is |
| --- | --- | --- |
| Hardware bench | X-52 + headset | Guided pass/fail of axes, buttons, L/R audio |
| VTT (60s) | Throttle | Yellow aircraft on a vertical lane |
| ATT (60s) | Stick | Two-axis tracking, elevator inverted |
| AVTT (120s) | Both | Lane + field together |
| DLT (120s) | Headset + trigger/thumb | Simultaneous letters/numbers; attend one ear |
| Multitrack (180s) | All of the above | Tracking + dichotic |
| Emergency (120s) | T1–T6 or keys 1–6 | Spoken emergency while tracking |
| Full battery | ~13 min | Published PBM order |

**Dichotic rule (as described in the public literature):** before a trial you are told LEFT or RIGHT. Even number in that ear → **stick trigger**. Odd number in that ear → **throttle thumb**. Letters, and anything in the other ear, are ignored.

## Keyboard if the HOTAS is unplugged

- Stick: WASD or arrows (up = stick back = cursor up)
- Throttle: Q / E or R / F
- Even / stick trigger: Space
- Odd / throttle thumb: Left Shift
- Emergencies: 1–6

## Tests

```bash
npm test
```

Covers even/odd routing, ignored-ear false alarms, speed schedules, adaptive redirects, mapping detection, and that the spoken WAV tokens exist.

## Regenerating speech

Tokens are built with macOS `say` (Samantha). To rebuild:

```bash
python3 scripts/generate-audio.py
```
