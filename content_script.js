let isDubbingActive = false;
let observer = null;
let lastSpokenText = "";
let customVoices = {}; 
let recentlySpokenTexts = []; 
const MAX_RECENT_MEMORY = 5;
let translationCache = {}; 
let originalVideoVolumes = new Map(); 
let availableVoices = [];
let stableTimer = null;

// Feature Flags
const USE_LOCAL_TRANSLATION_FALLBACK = true;
const ENABLE_LIP_SYNC = true;

// Pre-load available voices from the browser
speechSynthesis.onvoiceschanged = () => {
  availableVoices = speechSynthesis.getVoices();
};

const voiceProfiles = {
  'Child_Male': { pitch: 1.4, rate: 1.1 },
  'Child_Female': { pitch: 1.5, rate: 1.1 },
  'Young_Male': { pitch: 1.0, rate: 1.1 },
  'Young_Female': { pitch: 1.2, rate: 1.1 },
  'Adult_Male': { pitch: 0.9, rate: 1.0 },
  'Adult_Female': { pitch: 1.1, rate: 1.0 },
  'Senior_Male': { pitch: 0.7, rate: 0.9 },
  'Senior_Female': { pitch: 0.8, rate: 0.9 },
  'Neutral': { pitch: 1.0, rate: 1.0 }
};

let lastSpeakerChangeTime = 0;
let currentSpeakerIndex = 0;

let GEMINI_API_KEY = "";
// --- UI Overlay ---
function createOverlayUI() {
  if (document.getElementById('tamil-dubber-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'tamil-dubber-overlay';
  
  // Start as a full-screen audio unlocker to bypass Chrome Autoplay rules
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(0,0,0,0.9); color: #fff; z-index: 9999999;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    font-family: Arial, sans-serif; backdrop-filter: blur(5px);
  `;
  
  const title = document.createElement('h1');
  title.innerText = '🎙️ Thamizh AI Dubber Ready!';
  title.style.margin = '0 0 10px 0';
  
  const sub = document.createElement('p');
  sub.innerText = "Browser policy requires you to click once to unlock the audio system.";
  sub.style.color = '#ccc';
  sub.style.marginBottom = '30px';
  
  const startBtn = document.createElement('button');
  startBtn.innerText = '▶ CLICK TO UNLOCK & START DUBBING';
  startBtn.style.cssText = `
    background: linear-gradient(135deg, #00C9B1, #0093E9); border: none; color: white; padding: 18px 36px;
    border-radius: 12px; cursor: pointer; font-size: 22px; font-weight: bold;
    box-shadow: 0 8px 20px rgba(0, 201, 177, 0.4); transition: transform 0.2s;
  `;
  
  startBtn.onmouseover = () => { startBtn.style.transform = "scale(1.05)"; };
  startBtn.onmouseout = () => { startBtn.style.transform = "scale(1)"; };
  
  startBtn.onclick = () => {
      window.speechSynthesis.cancel(); // Flush any frozen utterances from the past
      
      // 100% Guaranteed Audio Unlock since this is a physical DOM click
      const unlockUtterance = new SpeechSynthesisUtterance("Dubbing started");
      unlockUtterance.volume = 0;
      window.speechSynthesis.speak(unlockUtterance);
      
      // Transform UI to the small corner widget
      overlay.style.cssText = `
        position: fixed; top: 70px; right: 20px; width: auto; height: auto;
        background: rgba(0,0,0,0.85); padding: 12px 18px; border-radius: 8px; z-index: 9999999;
        display: flex; flex-direction: column; gap: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.3);
        border: 1px solid #444; align-items: flex-start;
      `;
      title.innerHTML = '🎙️ <b>Tamil AI Dubbing Active</b><br><small style="color:#aaa;">(Make sure Video CC is ON)</small>';
      title.style.fontSize = '14px';
      
      startBtn.remove();
      sub.remove();
      
      const stopBtn = document.createElement('button');
      stopBtn.innerText = 'Stop Dubbing';
      stopBtn.style.cssText = `
        background: #ff4444; border: none; color: white; padding: 6px 12px;
        border-radius: 4px; cursor: pointer; font-weight: bold; width: 100%;
      `;
      stopBtn.onclick = () => stopDubbing();
      overlay.appendChild(stopBtn);
      
      // Lower video volume
      const videos = document.getElementsByTagName('video');
      for (const video of videos) {
        if (!originalVideoVolumes.has(video)) originalVideoVolumes.set(video, video.volume);
        video.volume = 0.1;
      }
      
      startObserver();
      console.log("Tamil AI Dubbing started.");
  };
  
  overlay.appendChild(title);
  overlay.appendChild(sub);
  overlay.appendChild(startBtn);
  document.body.appendChild(overlay);
}

function removeOverlayUI() {
  const overlay = document.getElementById('tamil-dubber-overlay');
  if (overlay) overlay.remove();
}

// --- Main Control ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'start_dubbing') {
    if (request.apiKey) {
      GEMINI_API_KEY = request.apiKey;
    }
    startDubbing();
    sendResponse({ status: "started" });
  } else if (request.action === 'stop_dubbing') {
    stopDubbing();
    sendResponse({ status: "stopped" });
  }
});

function startDubbing() {
  if (isDubbingActive) return;
  
  isDubbingActive = true;
  createOverlayUI();
}

function stopDubbing() {
  isDubbingActive = false;
  window.speechSynthesis.cancel(); 
  
  const videos = document.getElementsByTagName('video');
  for (const video of videos) {
    if (originalVideoVolumes.has(video)) {
      video.volume = originalVideoVolumes.get(video);
    } else {
      video.volume = 1.0; 
    }
  }
  originalVideoVolumes.clear();

  removeOverlayUI();
  stopObserver();
  console.log("Tamil AI Dubbing stopped.");
}

function startObserver() {
  if (observer) return;

  // Watchdog ensures TTS never hangs
  setInterval(() => {
    if (window.speechSynthesis.pending && !window.speechSynthesis.speaking) {
      window.speechSynthesis.resume();
    }
  }, 2000);

  // Netflix/Amazon/Hotstar often recreate subtitle nodes entirely rather than mutating them.
  // We use a high-frequency polling hybrid alongside the observer for maximum compatibility.
  setInterval(() => {
      if (!isDubbingActive) return;
      extractTextAndQueue();
  }, 500); 

  const targetNode = document.body; 
  const config = { childList: true, subtree: true, characterData: true, attributes: true };

  observer = new MutationObserver((mutations) => {
    if (!isDubbingActive) return;
    for (let mutation of mutations) {
      // Very loose check to allow the polling hybrid to do the heavy lifting
      if (mutation.type === 'childList' || mutation.type === 'characterData') {
           extractTextAndQueue();
           break;
      }
    }
  });

  observer.observe(targetNode, config);
}

function stopObserver() {
  if (observer) { observer.disconnect(); observer = null; }
}

function getAllSubtitles() {
   const subtitles = [];
   
   // 1. Visible DOM Captions (Supports YouTube, Hotstar, general HTML5 players)
   const domCaptions = document.querySelectorAll(`
      .caption, .captions, .subtitle, .subtitles,
      [class*="caption" i], [class*="subtitle" i],
      .ytp-caption-segment, .player-timedtext,
      .atvwebplayersdk-captions-text, .vjs-text-track-display,
      .shaka-text-container span, .shaka-text-wrapper span 
   `);
   domCaptions.forEach(el => {
       const text = el.innerText || el.textContent;
       if(text) subtitles.push(text.trim());
   });

   // 2. Shadow DOM & Netflix specific (Deep traversal)
   // Netflix often obfuscates classes but uses specific structure or Shadow DOM
   document.querySelectorAll('*').forEach(el => {
      // Shadow DOM Crawl
      if (el.shadowRoot) {
         el.shadowRoot.querySelectorAll('*').forEach(node => {
            const text = node.innerText || node.textContent;
            if (text && text.trim().length > 0) {
               subtitles.push(text);
            }
         });
      }
      
      // Amazon Prime Video specific
      if(el.classList && Array.from(el.classList).some(c => c.includes('atvwebplayersdk-captions-text'))) {
          const text = el.innerText || el.textContent;
          if(text) subtitles.push(text.trim());
      }
      
      // Netflix specific 
      if(el.className && typeof el.className === 'string' && el.className.includes('player-timedtext')) {
          const text = el.innerText || el.textContent;
          if(text) subtitles.push(text.trim());
      }
   });
   
   return [...new Set(subtitles)].join(" ").trim(); 
}



function extractTextAndQueue() {
  let currentText = getAllSubtitles();
  
  // Clean up excessive whitespace
  currentText = currentText.replace(/\s+/g, ' ').trim();

  // Ensure we don't process empty strings or repeat the exact same text rapidly
  if (currentText && currentText.length > 1 && currentText !== lastSpokenText) {
    clearTimeout(stableTimer);
    
    // We wait 450ms for the subtitle to "stable out" (some players render word-by-word)
    stableTimer = setTimeout(() => {
        if (!recentlySpokenTexts.includes(currentText)) {
            processFinalText(currentText);
        }
    }, 450);
  }
}

async function processFinalText(text) {
   recentlySpokenTexts.push(text);
   if (recentlySpokenTexts.length > MAX_RECENT_MEMORY) {
      recentlySpokenTexts.shift();
   }
   
   lastSpokenText = text;
   speakTamil(text); // Orchestrates the Gemini fetch and speech
}

// Helper: Capture a frame from the YouTube video
function captureVideoFrame() {
    try {
        const videos = document.getElementsByTagName('video');
        if (videos.length === 0) return null;
        const video = videos[0];

        // Ensure video has actual dimensions before capturing
        if (!video.videoHeight || !video.videoWidth) return null;

        const canvas = document.createElement('canvas');
        // Scale down to 480p equivalent to save API bandwidth and latency
        const scale = Math.min(1.0, 480 / video.videoHeight);
        if (!isFinite(scale) || scale <= 0) return null; // Safe guard

        canvas.width = video.videoWidth * scale;
        canvas.height = video.videoHeight * scale;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Convert to base64, removing the data URI header
        // This will purposely fail if the video is cross-origin restricted (CORS)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        return dataUrl.split(',')[1]; 
    } catch (e) {
        // Will catch "SecurityError: The operation is insecure." or "Tainted canvases may not be exported."
        console.warn("Notice: Gemini visual analysis disabled. Video frame capture is blocked by CORS/Cross-Origin restrictions on this platform.");
        return null;
    }
}

async function analyzeWithGemini(subtitleText, base64Image) {
  if (translationCache[subtitleText]) return translationCache[subtitleText]; 
  
  // FREE TIER / NO API KEY LOGIC
  if (!GEMINI_API_KEY) {
      try {
          // Use MyMemory Free API (Highly reliable for basic EN -> TA)
          const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(subtitleText)}&langpair=en|ta`);
          if (!response.ok) throw new Error("Translation API failed");
          
          const data = await response.json();
          if (data && data.responseData && data.responseData.translatedText) {
             const result = {
                 gender: "Neutral", 
                 age: "Adult", 
                 tamil_translation: data.responseData.translatedText
             };
             translationCache[subtitleText] = result;
             return result;
          } else {
             throw new Error("Invalid response format");
          }
      } catch (err) {
          console.warn("Free translation failed, using offline dictionary", err);
          return localTranslationFallback(subtitleText);
      }
  }

  // GEMINI PRO LOGIC
  try {
    const prompt = `Look at this video frame and the subtitle: "${subtitleText}". 
Context: You are an expert AI dubber translating English video subtitles to Tamil. Analyze the visual context of the video frame and translate the subtitle accurately.
1. Identify the gender and approximate age of the current speaker or narrator (e.g. Child, Young, Adult, Senior).
2. Translate the subtitle into highly accurate, natural, conversational "Pechu" Tamil. 
   - Ensure the meaning exactly matches the visual and textual context.
   - Do not use overly formal/bookish Tamil words unless appropriate for a news/documentary context.
Return ONLY JSON: {"gender": "Male|Female", "age": "Child|Young|Adult|Senior", "tamil_text": "..."}`;

    const payload = {
        contents: [{
            parts: [
                { text: prompt },
                ...(base64Image ? [{
                    inline_data: {
                        mime_type: "image/jpeg",
                        data: base64Image
                    }
                }] : [])
            ]
        }],
        generationConfig: {
            temperature: 0.1, // Keep it deterministic
            response_mime_type: "application/json"
        }
    };

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    const resultText = data.candidates[0].content.parts[0].text;
    const jsonResult = JSON.parse(resultText); 
    
    const result = {
        gender: jsonResult.gender || "Neutral",
        age: jsonResult.age || "Adult",
        tamil_translation: jsonResult.tamil_text
    };
    
    translationCache[subtitleText] = result; 
    return result; 
    
  } catch (error) {
    console.error('Gemini API Error, falling back to local processing if available:', error);
    return localTranslationFallback(subtitleText);
  }
}

// Local GPU Translation Fallback Simulation
// In a real WebGPU environment, this would initialize a small local model (e.g. MarianMT via transformers.js)
function localTranslationFallback(text) {
    if(!USE_LOCAL_TRANSLATION_FALLBACK) return { gender: "Neutral", age:"Adult", tamil_translation: text };
    
    console.warn("Using offline fallback dictionary...");
    // Extremely basic fallback dictionary for offline mode
    const offlineDict = {
        "hello": "வணக்கம்",
        "yes": "ஆமாம்",
        "no": "இல்லை",
        "thank you": "நன்றி"
    };
    
    let t = text.toLowerCase();
    for (const [eng, tam] of Object.entries(offlineDict)) {
        t = t.replaceAll(eng, tam);
    }
    
    return { gender: "Neutral", age: "Adult", tamil_translation: t };
}

function waitUntilFinished() {
  return new Promise(resolve => {
    const check = setInterval(() => {
      if (!speechSynthesis.speaking && !speechSynthesis.pending) {
        clearInterval(check);
        resolve();
      }
    }, 80);
  });
}

async function speakTamil(text) {
  const base64Image = captureVideoFrame();

  // Flash API overlay text
  const overlayTitle = document.querySelector('#tamil-dubber-overlay b');
  if (overlayTitle) overlayTitle.innerText = "Analyzing Context with Gemini 1.5 Pro...";

  // Get translation and simulated gender
  const geminiResult = await analyzeWithGemini(text, base64Image);
  
  if (overlayTitle) overlayTitle.innerText = "Tamil AI Dubbing Active";

  // Double-check the translation to ensure Pechu Tamil just in case Gemini falls back to formal
  const spokenTamilText = convertToSpokenTamil(geminiResult.tamil_translation); 
  
  const utterance = new SpeechSynthesisUtterance(spokenTamilText);
  utterance.lang = 'ta-IN'; 
  utterance.volume = 1.0; 
  
  // Voice Selection
  const bestVoice = getBestTamilVoice();
  if (bestVoice) utterance.voice = bestVoice;
  
  // Apply Age + Gender Pitch Profile dynamically
  const profileKey = `${geminiResult. возраст || geminiResult.age}_${geminiResult.gender}`;
  const profile = voiceProfiles[profileKey] || voiceProfiles['Adult_Neutral'] || voiceProfiles['Neutral'];
  
  if (profile) {
      utterance.pitch = profile.pitch;
      utterance.rate = profile.rate;
  }

  const videoElements = document.getElementsByTagName('video');
  if (videoElements.length > 0) {
    const video = videoElements[0];
    
    // English -> Tamil Lip-Sync Simulation
    // English is often shorter or longer than Tamil. We adjust the TTS rate based on
    // character density ratios to roughly match the Tamil audio length to the English subtitle duration.
    if(ENABLE_LIP_SYNC) {
         const englishCharCount = text.length;
         const tamilCharCount = spokenTamilText.length;
         
         if(englishCharCount > 0 && tamilCharCount > 0) {
             const ratio = tamilCharCount / englishCharCount;
             // If Tamil is significantly longer, speed it up. If shorter, slow it down.
             // Clamp the values to keep the voice sounding human
             let syncFactor = ratio * 0.8; 
             syncFactor = Math.max(0.7, Math.min(1.4, syncFactor)); 
             utterance.rate = utterance.rate * syncFactor;
         }
    }
    
    utterance.rate = utterance.rate * video.playbackRate;
  }
  
  await waitUntilFinished();
  window.speechSynthesis.speak(utterance);
}

// Helper: Find the highest quality Native Tamil voice
function getBestTamilVoice() {
  if (availableVoices.length === 0) availableVoices = speechSynthesis.getVoices();
  
  const preferredNames = [
     "Google தமிழ்",
     "Google India Tamil",
     "Microsoft Pallavi Online",
     "Microsoft Valluvar Online",
     "Pallavi", 
     "Valluvar"
  ];
  for (const name of preferredNames) {
     const v = availableVoices.find(voice => voice.name.includes(name));
     if (v) return v;
  }
  return availableVoices.find(v => v.lang.includes("ta"));
}

// Helper: Convert Formal Translate Tamil to Spoken "Pechu" Tamil (Basic NLP Replacement)
function convertToSpokenTamil(text) {
    let t = text;
    
    // Ordered from most specific to least specific to prevent partial word corruption
    const dictionary = {
        // Pronouns & Nouns
        "அவர்கள்": "அவுங்க", "இவர்கள்": "இவுங்க", "அவன்": "அவன்", "இவன்": "இவன்",
        "அவள்": "அவ", "இவள்": "இவ", "நான்": "நான்", "நாங்கள்": "நாங்க",
        "நீங்கள்": "நீங்க", "உனக்கு": "உனக்கு", "எனக்கு": "எனக்கு", "நமக்கு": "நமக்கு",
        "அதை": "அத", "இதை": "இத", "எதை": "எத",
        "அதனால்": "அதனால", "இதனால்": "இதனால", "எதனால்": "எதனால",
        "அங்கு": "அங்க", "இங்கு": "இங்க", "எங்கு": "எங்க", "எங்கே": "எங்க",
        
        // Questions
        "என்னுடைய": "என்னோட", "உன்னுடைய": "உன்னோட", 
        "எப்போது": "எப்போ", "எப்படி": "எப்பிடி", "எவ்வளவு": "எவ்ளோ", "ஏன்": "ஏன்",
        
        // Verbs - Present Tense
        "செய்கிறேன்": "செய்றேன்", "செய்கிறாய்": "செய்ற", "செய்கிறார்": "செய்றாரு", "செய்கிறார்கள்": "செய்றாங்க",
        "செல்கிறேன்": "போறேன்", "செல்கிறாய்": "போற", "செல்கிறார்": "போறாரு", "செல்கிறார்கள்": "போறாங்க",
        "வருகிறேன்": "வரேன்", "வருகிறாய்": "வர", "வருகிறார்": "வராரு", "வருகிறார்கள்": "வராங்க",
        "இருக்கிறேன்": "இருக்கேன்", "இருக்கிறாய்": "இருக்க", "இருக்கிறார்": "இருக்காரு", "இருக்கிறார்கள்": "இருக்காங்க",
        "சொல்கிறேன்": "சொல்றேன்", "சொல்கிறாய்": "சொல்ற", "சொல்கிறார்": "சொல்றாரு", "சொல்கிறார்கள்": "சொல்றாங்க",
        "பார்க்கிறேன்": "பாக்குறேன்", "பார்க்கிறாய்": "பாக்குற", "பார்க்கிறார்": "பாக்குறாரு", "பார்க்கிறார்கள்": "பாக்குறாங்க",
        "கேட்கிறேன்": "கேக்குறேன்", "கேட்கிறாய்": "கேக்குற", "கேட்கிறார்": "கேக்குறாரு", "கேட்கிறார்கள்": "கேக்குறாங்க",
        "நினைக்கிறேன்": "நெனைக்கிறேன்", "நினைக்கிறாய்": "நெனைக்கிற", "நினைக்கிறார்": "நெனைக்கிறாரு",
        
        // Verbs - Past Tense
        "செய்தேன்": "செஞ்சேன்", "செய்தாய்": "செஞ்ச", "செய்தார்": "செஞ்சாரு", "செய்தார்கள்": "செஞ்சாங்க",
        "வந்தேன்": "வந்தேன்", "வந்தாய்": "வந்த", "வந்தார்": "வந்தாரு", "வந்தார்கள்": "வந்தாங்க",
        "சென்றேன்": "போனேன்", "சென்றாய்": "போன", "சென்றார்": "போனாரு", "சென்றார்கள்": "போனாங்க",
        "பார்த்தேன்": "பாத்தேன்", "பார்த்தாய்": "பாத்த", "பார்த்தார்": "பாத்தாரு", "பார்த்தார்கள்": "பாத்தங்க",
        "சொன்னேன்": "சொன்னேன்", "சொன்னாய்": "சொன்ன", "சொன்னார்": "சொன்னாரு", "சொன்னார்கள்": "சொன்னாங்க",
        
        // Linking & Helper Words
        "கொண்டு": "கிட்டு", "கொண்டிருக்கிறேன்": "கிட்டிருக்கேன்", "கொண்டிருக்கிறார்": "கிட்டிருக்காரு",
        "வேண்டும்": "வேணும்", "வேண்டாம்": "வேண்டாம்",
        "இல்லை": "இல்ல", "ஆம்": "ஆமா", 
        "நன்றாக": "நல்லா", "மிகவும்": "ரொம்ப",
        "என்று": "ன்னு", "ஆகிவிட்டது": "ஆயிடுச்சு", "போய்விட்டது": "போயிடுச்சு",
        "முடியும்": "முடியும்", "முடியாது": "முடியாது",
        "தெரியும்": "தெரியும்", "தெரியாது": "தெரியாது",
        "உள்ளது": "இருக்கு"
    };

    // Replace all exact word matches
    for (const [formal, spoken] of Object.entries(dictionary)) {
        t = t.replaceAll(formal, spoken);
    }
    
    // Aggressive catch-all suffix replacements for formal verbs (e.g., ஓடுகிறேன் -> ஓடுறேன்)
    t = t.replaceAll("கிறேன்", "றேன்");
    t = t.replaceAll("கிறாய்", "ற");
    t = t.replaceAll("கிறார்", "றாரு");
    t = t.replaceAll("கிறார்கள்", "றாங்க");
    
    return t;
}
