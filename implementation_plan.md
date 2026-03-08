# Improving Tamil Pronunciation Quality

The user requested that the Tamil AI dubbing sound more natural and correct ("correct ah pesanum"). The current implementation relies solely on setting `utterance.lang = 'ta-IN'`, which sometimes causes the browser to pick a low-quality fallback voice or a generic pronunciation model if multiple Tamil voices exist.

## Proposed Changes

### [content_script.js](file:///e:/My_AI_Project/content_script.js)
- **Modify** to explicitly load available system voices using `window.speechSynthesis.getVoices()` and listen for the `voiceschanged` event.
- **Modify** the [speakTamil](file:///e:/My_AI_Project/content_script.js#221-269) function to actively filter for Tamil voices (`ta-IN` or [ta](file:///e:/My_AI_Project/content_script.js#90-118)) and prioritize high-quality neural/online voices like "Google தமிழ்" (Chrome) or "Microsoft Pallavi/Valluvar Online" (Edge).
- **Modify** to explicitly assign the selected high-quality `bestVoice` to the `SpeechSynthesisUtterance.voice` property.

## Verification Plan
### Automated Tests
- None applicable for Web Speech API text-to-speech rendering differences.
### Manual Verification
- Ask the user to reload the extension, refresh a video, and test the dubbing to see if the pronunciation sounds more native and high-quality.
