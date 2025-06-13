document.getElementById("roll-number-form").addEventListener("submit", async function (e) {
  e.preventDefault();

  const startRoll = document.getElementById("start-roll").value.trim();
  const endRoll = document.getElementById("end-roll").value.trim();
  const resultName = document.getElementById("result-name").value.trim();

  // Input validation
  if (!startRoll || !endRoll || !resultName) {
    alert("Please fill all fields.");
    return;
  }

  // Validation: length check
  if (startRoll.length !== 10 || endRoll.length !== 10) {
    alert("Roll numbers must be exactly 10 characters long.");
    return;
  }

  // Validation: prefix match (first 6 characters)
  const prefixStart = startRoll.slice(0, 6);
  const prefixEnd = endRoll.slice(0, 6);
  if (prefixStart !== prefixEnd) {
    alert("First 6 characters of start and end roll numbers must match.");
    return;
  }

  // Validation: numeric last 4 digits and range ≤ 200
  const rollStart = parseInt(startRoll.slice(-4));
  const rollEnd = parseInt(endRoll.slice(-4));
  const total = rollEnd - rollStart + 1;

  if (isNaN(rollStart) || isNaN(rollEnd) || total <= 0) {
    alert("Last 4 characters of roll numbers must be numeric and valid.");
    return;
  }

  if (total > 200) {
    alert("Roll number range cannot exceed 200.");
    return;
  }

  // UI references
  const log = (msg) => {
    const logSection = document.getElementById("log-section");
    const line = document.createElement("div");
    line.textContent = msg;
    logSection.appendChild(line);
  };

  document.getElementById("progress-section").classList.remove("hidden");
  document.getElementById("log-section").innerHTML = "";
  document.getElementById("pdf-viewer-section").classList.add("hidden");

  const progressBar = document.getElementById("progress-bar");
  const progressText = document.getElementById("progress-text");

  log(`➡️ Generating PDFs from ${startRoll} to ${endRoll}...`);

  try {
    const response = await fetch("http://localhost:5000/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startRoll, endRoll, resultName }),
    });

    if (!response.ok) {
      throw new Error(`Server returned error: ${response.statusText}`);
    }

    const data = await response.json();
    const { downloadURL, notFound } = data;

    const foundCount = total - notFound.length;
    progressBar.style.width = "100%";
    progressText.textContent = `✅ Done: ${foundCount} found, ${notFound.length} not found.`;

    if (notFound.length > 0) {
      log("⚠️ Not Found:");
      notFound.forEach(roll => log(`❌ ${roll}`));
    }

    // Only show PDF preview if at least one roll was found
    if (foundCount > 0 && downloadURL) {
      const iframe = document.getElementById("pdf-iframe");
      const downloadBtn = document.getElementById("download-btn");

      iframe.src = downloadURL;
      downloadBtn.href = downloadURL;

      document.getElementById("pdf-viewer-section").classList.remove("hidden");
    } else {
      log("❌ No valid roll numbers found. Preview not shown.");
    }

  } catch (error) {
    log("❌ Failed to fetch the data. Please try again later.");
    console.error("Error:", error);
  }
});
