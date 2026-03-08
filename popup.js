document.addEventListener("DOMContentLoaded", () => {
    const toggleBtn = document.getElementById("toggleBtn");
    const btnText = document.getElementById("btnText");

    // 1. Load initial state on popup open
    chrome.storage.local.get(["isDubbing"], (result) => {
        const isDubbing = !!result.isDubbing;
        updateUI(isDubbing);
    });

    // 2. Handle Start/Stop Toggle Click
    toggleBtn.addEventListener("click", () => {
        chrome.storage.local.get(["isDubbing"], (result) => {
            const newState = !result.isDubbing;
            
            // Save state
            chrome.storage.local.set({ isDubbing: newState });
            updateUI(newState);
            
            // Send the new state to the active tab's content_script.js
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs.length > 0) {
                    const actionName = newState ? "start_dubbing" : "stop_dubbing";
                    chrome.tabs.sendMessage(tabs[0].id, { 
                        action: actionName
                    }).catch(err => {
                        console.warn("Content script may not be ready yet. Reload the video page if needed.", err);
                    });
                }
            });
        });
    });

    // 3. Update the button visuals based on the State
    function updateUI(isDubbing) {
        if (isDubbing) {
            toggleBtn.classList.add("active");
            btnText.innerText = "Stop Tamil Dub";
        } else {
            toggleBtn.classList.remove("active");
            btnText.innerText = "Start Tamil Dub";
        }
    }
});
