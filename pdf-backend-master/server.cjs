const express = require('express');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const cors = require('cors');
const axios = require('axios');
const { mergePDFs } = require('./utils/mergePDFs.cjs');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Serve the merged PDF folder statically
app.use('/merged', express.static(path.join(__dirname, 'merged')));

// Create downloads and merged folders if they don't exist
const downloadsDir = path.join(__dirname, 'downloads');
const mergedDir = path.join(__dirname, 'merged');

if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir);
  console.log('📁 Created downloads folder');
}
if (!fs.existsSync(mergedDir)) {
  fs.mkdirSync(mergedDir);
  console.log('📁 Created merged folder');
}

// Utility: Clean a folder
const cleanFolder = (folder) => {
  if (fs.existsSync(folder)) {
    fs.readdirSync(folder).forEach(file => {
      fs.unlinkSync(path.join(folder, file));
    });
  }
};

// Utility: Download a single PDF from a URL
const downloadPDF = async (pdfUrl, filePath) => {
  const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
  fs.writeFileSync(filePath, response.data);
};

// Health check route
app.get('/', (req, res) => {
  res.send('🚀 PDF backend server is running!');
});

// Favicon route to avoid unnecessary errors
app.get('/favicon.ico', (req, res) => res.status(204));

// Main POST route to handle PDF collection and merging
app.post('/', async (req, res) => {
  const { startRoll, endRoll, websiteURL } = req.body;

  if (!startRoll || !endRoll || !websiteURL) {
    return res.status(400).json({ error: 'Missing startRoll, endRoll or websiteURL' });
  }

  const notFound = [];
  const prefix = startRoll.slice(0, startRoll.length - 4);
  const startNum = parseInt(startRoll.slice(-4));
  const endNum = parseInt(endRoll.slice(-4));

  cleanFolder(downloadsDir);
  cleanFolder(mergedDir);

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  for (let i = startNum; i <= endNum; i++) {
    const roll = `${prefix}${i.toString().padStart(4, '0')}`;
    console.log(`➡️ Processing Roll No: ${roll}`);

    try {
      await page.goto(websiteURL, { waitUntil: 'networkidle2' });

      // Click the result link (customize selector if needed)
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.evaluate(() => {
          __doPostBack('dgResultUG$ctl07$lnkResultUG', ''); // 🔁 Adjust if ID changes
        }),
      ]);

      // Enter roll number
      await page.waitForSelector('#txtRollNo');
      await page.evaluate(() => (document.querySelector('#txtRollNo').value = ''));
      await page.type('#txtRollNo', roll);
      await page.click('#btnGetResult');
      console.log(`⏳ Waiting for result...`);

      // Wait for result to appear
      await page.waitForSelector('#lblName', { timeout: 4000 });
      console.log(`✅ Result found for ${roll}`);

      // Get the PDF URL
      const pdfUrl = await page.evaluate(() => {
        const link = document.querySelector('a[href$=".pdf"]');
        return link ? link.href : null;
      });

      if (!pdfUrl) throw new Error('PDF URL not found');

      // Download the PDF
      const pdfPath = path.join(downloadsDir, `${roll}.pdf`);
      await downloadPDF(pdfUrl, pdfPath);
      console.log(`📄 Downloaded: ${roll}.pdf`);

    } catch (err) {
      console.error(`❌ Failed for ${roll}: ${err.message}`);
      notFound.push(roll);
    }
  }

  await browser.close();

  // Merge all PDFs
  const mergedPath = path.join(mergedDir, 'Final_Merged.pdf');
  await mergePDFs(downloadsDir, mergedPath);
  console.log(`✅ Merged PDF created at: ${mergedPath}`);

  // Respond with the URL and not-found list
  res.json({
    downloadURL: '/merged/Final_Merged.pdf',
    notFound,
  });
});

// Global error handling
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
