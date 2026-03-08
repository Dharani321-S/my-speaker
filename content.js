/**
 * Tamil AI Dubbing Content Script
 * This script runs in the context of the requested web page.
 * It detects the video element, reads the subtitle tracks, translates 
 * them in real-time using a public API, and uses Web Speech API for dubbing.
 */

// Global State
let isDubbingEnabled = false;
let speechQueue = [];
let isSpeaking = false;
let currentSubtitleTrack = null;

// The Speech Synthesis Engine
const synth = window.speechSynthesis;

// 1. Initialization
init();

function init() {
    // Check initial state from popup settings
    chrome.storage.local.get(["isDubbing"], (result) => {
        isDubbingEnabled = !!result.isDubbing;
        if (isDubbingEnabled) {
            console.log("Tamil AI Dubbing is Enabled.");
            attemptToSync();
        }
    });

    // We can also observe the DOM incase the video hasn't loaded immediately.
    // For simplicity, we just look for video on start and on state change.
}

// 2. Listen for "Start Tamil Dub" or Stop messages from the popup UI
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "toggleDubbing") {
        isDubbingEnabled = request.state;
        
        if (!isDubbingEnabled) {
            stopDubbing();
            console.log("Tamil Dubbing Stopped.");
        } else {
            console.log("Tamil Dubbing Started.");
            attemptToSync();
        }
        sendResponse({ status: "success" });
    }
});

function stopDubbing() {
    synth.cancel();         // Stop any current speech
    speechQueue = [];       // Clear queue
    isSpeaking = false;     // Reset flag
    
    // Clear listener if we have a track
    if (currentSubtitleTrack) {
        currentSubtitleTrack.oncuechange = null;
        currentSubtitleTrack = null;
    }
}

// 3. Core Logic: Find Subtitles and Attach Listeners
function attemptToSync() {
    // Detect the video element using JavaScript constraint.
    const video = document.querySelector("video");
    if (!video) {
        console.warn("No HTML5 video element found on this page.");
        return;
    }

    // Detect subtitle tracks from the video element (<track kind="subtitles">)
    const textTracks = video.textTracks;
    let subtitleTrack = null;
    
    for (let i = 0; i < textTracks.length; i++) {
        const track = textTracks[i];
        if (track.kind === "subtitles" || track.kind === "captions") {
            // "hidden" mode means the captions don't show on screen if they weren't already,
            // but the `cuechange` events will still fire. We can use "showing" if we also want them visible.
            track.mode = track.mode === "disabled" ? "hidden" : track.mode; 
            subtitleTrack = track;
            break; 
        }
    }

    // Handle cases where subtitles are missing
    if (!subtitleTrack) {
        console.warn("No standard subtitle track found attached to the video element. Dubbing needs <track>.");
        // A full production extension might also parse custom subtitle divs (like on YouTube/Netflix),
        // but for this prototype, we stick to HTML5 textTracks per requirements.
        return;
    }

    console.log("Subtitle track detected. Syncing Tamil Speech...");
    currentSubtitleTrack = subtitleTrack;

    // Automatically detect when subtitles change
    currentSubtitleTrack.oncuechange = (event) => {
        if (!isDubbingEnabled) return;
        
        const activeCues = event.target.activeCues;
        if (activeCues && activeCues.length > 0) {
            // Take the first active cue
            const cue = activeCues[0]; 
            
            // Read subtitle text and timestamps
            const text = cue.text;
            console.log(`[${cue.startTime} - ${cue.endTime}] Subtitle Detected: "${text}"`);
            
            translateSubtitleAndQueue(text);
        }
    };
}

// 4. Translate subtitle text from English to Tamil using a translation API
async function translateSubtitleAndQueue(text) {
    // Clean text by stripping tags like <i>, <b>, \n, etc.
    const cleanText = text.replace(/<[^>]*>/g, '').replace(/\n/g, ' ').trim();
    if (!cleanText) return;

    try {
        // Use a FREE public translation API (MyMemory).
        // It provides 500 requests per day without a key, perfect for prototypes.
        const encodedText = encodeURIComponent(cleanText);
        const url = `https://api.mymemory.translated.net/get?q=${encodedText}&langpair=en|ta`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data && data.responseData && data.responseData.translatedText) {
            const tamildub = data.responseData.translatedText;
            console.log(`Translated: "${cleanText}" -> "${tamildub}"`);
            
            // Sync is handled by virtue of processing the `cuechange` basically upon `startTime`.
            // Queue the speech so it does not overlap.
            queueSpeech(tamildub);
        } else {
            console.warn("Translation didn't return expected text format", data);
        }
    } catch (error) {
        console.error("Translation API error:", error);
    }
}

// 5. Speak Subtitles in Queue without Overlapping
function queueSpeech(text) {
    speechQueue.push(text);
    processSpeechQueue();
}

function processSpeechQueue() {
    // Wait if it's currently speaking, the onend event will recall this.
    if (isSpeaking || speechQueue.length === 0) return;
    
    isSpeaking = true;
    const textToSpeak = speechQueue.shift();
    
    // Convert the translated Tamil text into speech using the Web Speech API
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.lang = 'ta-IN'; // Tamil (India)
    utterance.rate = 1.15;    // Keep pace slightly faster to stay synced with video flow
    
    // Look for a native Tamil voice if available in the OS
    const voices = synth.getVoices();
    const tamilVoice = voices.find(v => v.lang.toLowerCase().includes('ta'));
    if (tamilVoice) {
        utterance.voice = tamilVoice;
    }

    // Call back once speech ends, grab the next line
    utterance.onend = () => {
        isSpeaking = false;
        processSpeechQueue();
    };

    // Failsafe / Drop on error
    utterance.onerror = (e) => {
        console.error("Web Speech API Error:", e);
        isSpeaking = false;
        processSpeechQueue();
    };

    synth.speak(utterance);
}

// Ensure Web Speech API voices are populated (browser quirk resolution)
if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = () => synth.getVoices();
}
