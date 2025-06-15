const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const chromium = require("chrome-aws-lambda");

const app = express();
const PORT = process.env.PORT || 5002;

// Setup paths
const downloadsDir = path.join(__dirname, "downloads");
if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"))); // Serve frontend if needed

// Utility to delay
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// Launch Chromium
const createBrowser = async () => {
  return await chromium.puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath,
    headless: chromium.headless,
    defaultViewport: chromium.defaultViewport,
  });
};

// POST /result
app.post("/result", async (req, res) => {
  const { startRoll, endRoll, academicYear, examType, semester, semesterType, branch } = req.body;

  if (!startRoll || !endRoll) {
    return res.status(400).json({ error: "Missing roll numbers" });
  }

  const rollStart = parseInt(startRoll.slice(-4));
  const rollEnd = parseInt(endRoll.slice(-4));
  const total = rollEnd - rollStart + 1;

  const notFound = [];
  const browser = await createBrowser();
  const page = await browser.newPage();

  const pdfPaths = [];

  for (let i = rollStart; i <= rollEnd; i++) {
    const roll = startRoll.slice(0, 6) + i.toString().padStart(4, "0");
    try {
      const targetURL = `https://university.com/result?roll=${roll}&year=${academicYear}&sem=${semester}`; // replace with actual URL
      await page.goto(targetURL, { waitUntil: "networkidle2", timeout: 30000 });

      const pdfPath = path.join(downloadsDir, `${roll}.pdf`);
      await page.pdf({ path: pdfPath, format: "A4" });
      pdfPaths.push(pdfPath);
    } catch (err) {
      notFound.push(roll);
      continue;
    }
  }

  await browser.close();

  if (pdfPaths.length === 0) {
    return res.json({ notFound });
  }

  const mergedPath = path.join(downloadsDir, `Merged_${Date.now()}.pdf`);
  const { PDFDocument } = require("pdf-lib");
  const mergedPdf = await PDFDocument.create();

  for (const filePath of pdfPaths) {
    const pdfBytes = fs.readFileSync(filePath);
    const doc = await PDFDocument.load(pdfBytes);
    const copiedPages = await mergedPdf.copyPages(doc, doc.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }

  const mergedBytes = await mergedPdf.save();
  fs.writeFileSync(mergedPath, mergedBytes);

  // Return merged download URL
  const mergedURL = `/downloads/${path.basename(mergedPath)}`;
  res.json({ downloadURL: mergedURL, notFound });
});

// Serve merged PDFs
app.use("/downloads", express.static(downloadsDir));

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
