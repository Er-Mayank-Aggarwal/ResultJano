document.getElementById("roll-number-form").addEventListener("submit", async function (e) {
  e.preventDefault();

  const startRoll = document.getElementById("start-roll").value;
  const endRoll = document.getElementById("end-roll").value;
  const websiteURL = document.getElementById("website-url").value;

  // Input validation
  if (!startRoll || !endRoll || !websiteURL) {
    alert("Please fill all fields.");
    return;
  }

  const log = (msg) => {
    const logSection = document.getElementById("log-section");
    const line = document.createElement("div");
    line.textContent = msg;
    logSection.appendChild(line);
  };

  // Show progress UI
  document.getElementById("progress-section").classList.remove("hidden");
  document.getElementById("log-section").innerHTML = ""; // clear logs
  document.getElementById("pdf-viewer-section").classList.add("hidden"); // hide PDF viewer initially

  const total = parseInt(endRoll.slice(-4)) - parseInt(startRoll.slice(-4)) + 1;
  const progressBar = document.getElementById("progress-bar");
  const progressText = document.getElementById("progress-text");

  log(`➡️ Generating PDFs from ${startRoll} to ${endRoll}...`);
  
  try {
    // Make the POST request to the live backend URL
    const response = await fetch("http://localhost:5000/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startRoll, endRoll, websiteURL }),
    });

    // Check if the response is OK (status 200-299)
    if (!response.ok) {
      throw new Error(`Server returned error: ${response.statusText}`);
    }

    // Parse the JSON response
    const data = await response.json();
    const { downloadURL, notFound } = data;

    // Update progress bar and status text
    progressBar.style.width = "100%";
    progressText.textContent = `✅ Done: ${total - notFound.length} found, ${notFound.length} not found.`;

    // Log not found roll numbers
    if (notFound.length > 0) {
      log("⚠️ Not Found:");
      notFound.forEach(roll => log(`❌ ${roll}`));
    }

    // If PDF URL is returned, display it
    if (downloadURL) {
      const iframe = document.getElementById("pdf-iframe");
      const downloadBtn = document.getElementById("download-btn");

      iframe.src = downloadURL; // Set the src of iframe to view PDF
      downloadBtn.href = downloadURL; // Set the download button link

      // Show the PDF viewer section
      document.getElementById("pdf-viewer-section").classList.remove("hidden");
    } else {
      log("❌ No merged PDF was created.");
    }

  } catch (error) {
    // Handle any error (network issues, server issues, etc.)
    log("❌ Failed to fetch the data. Please try again later.");
    console.error("Error:", error);
  }
});
