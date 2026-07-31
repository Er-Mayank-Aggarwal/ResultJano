const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const puppeteer = require('puppeteer');
const { mergePDFs } = require('./utils/mergePDFs.cjs');

const app = express();
const PORT = process.env.PORT || 5002;
const CONCURRENCY = 3; // Number of parallel browser contexts/tabs

console.log('Initializing server...');
const downloadsBaseDir = path.join(__dirname, 'downloads');
const mergedDir = path.join(__dirname, 'merged');
const publicDir = path.join(__dirname, 'public');

[downloadsBaseDir, mergedDir, publicDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    console.log(`Creating directory: ${dir}`);
    fs.mkdirSync(dir, { recursive: true });
  }
});

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});
app.use('/merged', express.static(mergedDir));
app.use(express.static(publicDir));

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const jobStore = {};

const getJobDownloadDir = (jobId) => {
  return path.join(downloadsBaseDir, `job_${jobId}`);
};

const ensureJobDir = async (jobId) => {
  const jobDir = getJobDownloadDir(jobId);
  if (!fs.existsSync(jobDir)) {
    console.log(`Creating job directory: ${jobDir}`);
    fs.mkdirSync(jobDir, { recursive: true });
  }
  return jobDir;
};

const waitForDownload = async (roll, downloadDir, timeoutMs = 3000) => {
  console.log(`Waiting for download of roll ${roll} in ${downloadDir}, timeout: ${timeoutMs}ms`);
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (fs.existsSync(downloadDir)) {
      const files = await fs.promises.readdir(downloadDir);
      const pdfFiles = files.filter(f => f.endsWith('.pdf') && !f.endsWith('.crdownload'));
      if (pdfFiles.some(f => f.includes(roll))) {
        console.log(`Download completed for roll ${roll}`);
        return true;
      }
    }
    await delay(150);
  }
  console.log(`Download timeout for roll ${roll}`);
  return false;
};

const cleanFolder = async folder => {
  if (!fs.existsSync(folder)) {
    console.log(`Folder doesn't exist, skipping cleanup: ${folder}`);
    return;
  }

  console.log(`Cleaning folder: ${folder}`);
  const files = await fs.promises.readdir(folder);
  console.log(`Found ${files.length} files to clean`);
  await Promise.all(files.map(file => fs.promises.unlink(path.join(folder, file))));
  console.log(`Folder ${folder} cleaned successfully`);
};

const deleteJobFolder = async (jobId) => {
  const jobDir = getJobDownloadDir(jobId);
  if (fs.existsSync(jobDir)) {
    console.log(`Deleting job folder: ${jobDir}`);
    await fs.promises.rm(jobDir, { recursive: true, force: true });
    console.log(`Job folder deleted: ${jobDir}`);
  }
};

const toRomanNumeral = num => {
  const romanNumerals = { 1: 'Ist', 2: 'IInd', 3: 'IIIrd', 4: 'IVth', 5: 'Vth', 6: 'VIth', 7: 'VIIth', 8: 'VIIIth'};
  return romanNumerals[num] || num.toString();
};

const createBrowser = async () => {
  console.log('Launching Puppeteer browser (headless)');
  return await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
};

const processRolls = async (browser, rolls, websiteURL, semesterType, academicYear, romanSemester, branch, jobId, examType, tabDownloadDir, downloadTimeout = 5000) => {
  console.log(`Processing ${rolls.length} roll numbers in tab dir: ${tabDownloadDir} (timeout: ${downloadTimeout}ms)`);
  const results = {};
  let context;
  let page;

  try {
    // Create an isolated browser context per tab so download directories do not override each other!
    context = await browser.createBrowserContext();
    page = await context.newPage();
    console.log(`New isolated browser context & page created for tab`);
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: tabDownloadDir });

    console.log(`Navigating to ${websiteURL}`);
    await page.goto(websiteURL, { waitUntil: 'networkidle2' });
    console.log(examType);
    if (examType == "normal") {
      console.log('Normal exam type selected');
      // Try ID-based selector first
      const idSelector = `#link${semesterType}Sem${academicYear}`;
      const elementExists = await page.$(idSelector);
      
      if (elementExists) {
        console.log(`Clicking on ${idSelector}`);
        await page.click(idSelector);
      } else {
        // Fallback: find the link by text content matching semester type and academic year
        console.log(`Selector ${idSelector} not found, falling back to text-based matching`);
        const startYear = parseInt(academicYear) - 1;
        const endYearShort = (parseInt(academicYear) % 100).toString().padStart(2, '0');
        const academicYearString = `${startYear}-${endYearShort}`;
        
        const clickedNormal = await page.evaluate((semType, yearStr) => {
          const links = Array.from(document.querySelectorAll('a'));
          const semLower = semType.toLowerCase();
          
          for (const link of links) {
            const text = link.textContent.toLowerCase();
            if (text.includes(semLower) && text.includes('semester') && text.includes(yearStr)) {
              console.log("✅ Match found:", link.textContent);
              link.click();
              return true;
            }
          }
          return false;
        }, semesterType, academicYearString);
        
        if (!clickedNormal) {
          console.log(`❌ No matching link found for: ${semesterType} Semester ${academicYearString}`);
          return {};
        }
        console.log(`✅ Normal exam link clicked via text matching`);
      }
      
      // Wait for ASP.NET AJAX PostBack to dynamically render branch links
      await page.waitForFunction(() => {
        const links = Array.from(document.querySelectorAll('a'));
        return links.some(l => l.textContent.toLowerCase().includes('b.e.(cbcs)'));
      }, { timeout: 10000 }).catch(() => {});
    }

    else if (examType === "reval") {
      console.log('Revaluation exam type selected');

      const clickedd = await page.evaluate((type, acadyear, semtype) => {
        const etype = type.toLowerCase();
        const year = parseInt(acadyear);
        const sem = semtype.toLowerCase();

        // Generate the academic year string (e.g., 2022-23 for input 2023)
        const startYear = year - 1;
        const endYearShort = (year % 100).toString().padStart(2, '0');
        const academicYearString = `${startYear}-${endYearShort}`;
        const links = Array.from(document.querySelectorAll('a'));

        for (const link of links) {
          console.log(`Checking link: ${link.textContent}`);
          const text = link.textContent.toLowerCase();
 
          if (text.includes(etype) &&
            text.includes(sem) &&
            text.includes(academicYearString)) {
            console.log("✅ Match found:", link.href);
            link.click();
            return true;
          }
        }
        return false;
      }, examType, academicYear, semesterType);

      if (!clickedd) {
        console.log(`❌ No matching revaluation link found for: ${examType} - ${academicYear} - ${semesterType}`);
        return {};
      }

      console.log(`✅ Revaluation link clicked`);
      await page.waitForFunction(() => {
        const links = Array.from(document.querySelectorAll('a'));
        return links.some(l => l.textContent.toLowerCase().includes('b.e.(cbcs)'));
      }, { timeout: 10000 }).catch(() => {});
    }

    else if (examType === "Makeup") {

    }
    else if (examType === "Supplementary") {

    }
    console.log(`Attempting to find and click ${romanSemester} semester for ${branch}`);

    const clicked = await page.evaluate((romanSem, branchName) => {
      const links = Array.from(document.querySelectorAll('a'));
      
      const normalize = (str) => str.toLowerCase().replace(/&/g, 'and');

      for (const link of links) {
        const text = normalize(link.textContent);
        const sem = romanSem.toLowerCase();
        const branch = normalize(branchName);

        let branchMatched = false;
        if (branch === 'ee') {
          // EE should match 'electrical engineering' or '(ee)' but avoid matching just 'electronics and electrical' alone if EE is requested
          branchMatched = text.includes('electrical engineering') || text.includes('(ee)');
        } else if (branch === 'electrical and electronics') {
          branchMatched = text.includes('electrical and electronics') || text.includes('electronics and electrical');
        } else {
          branchMatched = text.includes(branch);
        }

        if ((sem === 'ist' || sem === 'iind') && text.includes(sem) && text.includes("b.e.(cbcs)")) {
          console.log("Clicking link for Ist/IInd semester with CBCS");
          link.click();
          return true;
        } else if (text.includes(sem) && branchMatched && text.includes("b.e.(cbcs)")) {
          console.log("Clicking link for other semester with branch");
          link.click();
          return true;
        }
      }

      console.log("No matching link found.");
      return false;
    }, romanSemester, branch);

    if (!clicked) {
      console.log(`Failed to find link for ${romanSemester} semester and ${branch}`);
      return {};
    }

    await delay(500);
    await page.waitForSelector('#txtRollNo');

    for (let i = 0; i < rolls.length; i++) {
      const roll = rolls[i];
      jobStore[jobId].lastProcessedRoll = roll; // Track current roll
      console.log(`Processing roll ${roll} (${i + 1}/${rolls.length})`);

      await page.evaluate(() => document.querySelector('#txtRollNo').value = '');
      await page.type('#txtRollNo', roll);

      let dialogDetected = false;
      const onDialog = async dialog => {
        try {
          console.log(`Dialog appeared: ${dialog.message()}`);
          dialogDetected = true;
          await dialog.accept();
        } catch (err) {
          // Ignore
        }
      };

      page.once('dialog', onDialog);

      console.log(`Clicking get result button for ${roll}`);
      await page.click('#btnGetResult');

      // Small delay for click event dispatching
      await delay(200);
      page.off('dialog', onDialog);

      let success = false;
      if (!dialogDetected) {
        success = await waitForDownload(roll, tabDownloadDir, downloadTimeout);
      } else {
        console.log(`Dialog detected for roll ${roll}, no result available`);
      }

      results[roll] = success;
      jobStore[jobId].completed++;

      if (success) {
        console.log(`Successfully processed roll ${roll}`);
        jobStore[jobId].successful.push(roll);
      } else {
        console.log(`No result found for roll ${roll}`);
        jobStore[jobId].notFound.push(roll);
      }

      console.log(`Progress: ${jobStore[jobId].completed}/${jobStore[jobId].total} rolls processed`);

      await delay(100);
    }
  } catch (err) {
    console.error(`Error in batch processing:`, err);
  } finally {
    if (page) {
      console.log(`Closing page after batch processing`);
      await page.close().catch(() => {});
    }
    if (context) {
      await context.close().catch(() => {});
    }
  }

  return results;
};

app.post('/result', async (req, res) => {
  console.log('Received /result request:', req.body);
  const { startRoll, endRoll, academicYear, semester, semesterType, branch, examType, speed } = req.body;
  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  let downloadTimeout = 5000; // Fast = 5s (default)
  if (speed === 'very_fast') {
    downloadTimeout = 3000; // Very Fast = 3s
  } else if (speed === 'medium') {
    downloadTimeout = 10000; // Medium = 10s
  } else if (speed === 'slow') {
    downloadTimeout = 20000; // Slow / Low = 20s
  }

  const start = parseInt(startRoll.slice(-4));
  const end = parseInt(endRoll.slice(-4));
  const prefix = startRoll.slice(0, -4);
  const total = end - start + 1;

  console.log(`Creating job ${jobId} for rolls ${startRoll} to ${endRoll}, total: ${total}`);
  jobStore[jobId] = {
    status: 'pending',
    completed: 0,
    total,
    notFound: [],
    successful: [],
    startTime: Date.now(),
    lastProcessedRoll: null,
    currentStep: 'initializing',
    config: {
      startRoll,
      endRoll,
      academicYear,
      semester,
      semesterType,
      branch
    }
  };
  res.json({ jobId });

  try {
    const jobDir = await ensureJobDir(jobId);
    console.log(`Using job directory: ${jobDir}`);

    const browser = await createBrowser();
    const websiteURL = 'https://mbmiums.in/(S(zkvqtk0qyp2cyqpl4smvkq45))/Results/ExamResult.aspx';
    const romanSemester = semester === "annual" ? "annual" : toRomanNumeral(parseInt(semester)).toLowerCase();

    console.log(`Using roman semester: ${romanSemester}`);
    await cleanFolder(mergedDir);

    // Generate all roll numbers first
    const rolls = [];
    for (let i = start; i <= end; i++) {
      rolls.push(`${prefix}${i.toString().padStart(4, '0')}`);
    }

    jobStore[jobId].currentStep = 'processing_rolls';

    // Split rolls into chunks for parallel processing
    const numTabs = Math.min(CONCURRENCY, rolls.length);
    const chunks = [];
    for (let t = 0; t < numTabs; t++) {
      chunks.push([]);
    }
    rolls.forEach((roll, i) => chunks[i % numTabs].push(roll));

    console.log(`Splitting ${rolls.length} rolls across ${numTabs} parallel tabs`);

    // Create separate download directories per tab
    const tabDirs = [];
    for (let t = 0; t < numTabs; t++) {
      const tabDir = path.join(jobDir, `tab_${t}`);
      if (!fs.existsSync(tabDir)) {
        fs.mkdirSync(tabDir, { recursive: true });
      }
      tabDirs.push(tabDir);
    }

    // Process all chunks in parallel using isolated browser contexts
    await Promise.all(
      chunks.map((chunk, idx) =>
        processRolls(browser, chunk, websiteURL, semesterType, academicYear, romanSemester, branch, jobId, examType, tabDirs[idx], downloadTimeout)
      )
    );

    // Consolidate downloaded files from tab dirs into main job dir
    for (const tabDir of tabDirs) {
      if (fs.existsSync(tabDir)) {
        const files = await fs.promises.readdir(tabDir);
        for (const file of files) {
          const src = path.join(tabDir, file);
          const dest = path.join(jobDir, file);
          await fs.promises.rename(src, dest);
        }
        await fs.promises.rm(tabDir, { recursive: true, force: true });
      }
    }

    console.log('Closing browser');
    await browser.close();

    const mergedFile = `Merged_result.pdf`;
    const mergedPath = path.join(mergedDir, mergedFile);

    try {
      jobStore[jobId].currentStep = 'merging_pdfs';
      console.log(`Starting PDF merge from ${jobDir} to ${mergedPath}`);
      await mergePDFs(jobDir, mergedPath);
      console.log(`PDFs successfully merged to ${mergedPath}`);

      await deleteJobFolder(jobId);

      jobStore[jobId].status = 'done';
      jobStore[jobId].currentStep = 'complete';
      jobStore[jobId].endTime = Date.now();
      jobStore[jobId].downloadURL = `/merged/${mergedFile}`;
      console.log(`Job ${jobId} completed successfully`);
    } catch (err) {
      console.error(`PDF merge error:`, err);
      jobStore[jobId].status = 'error';
      jobStore[jobId].error = err.message;
      jobStore[jobId].currentStep = 'error';
      jobStore[jobId].endTime = Date.now();

      await deleteJobFolder(jobId);
    }
  } catch (err) {
    console.error(`Fatal error in job ${jobId}:`, err);
    jobStore[jobId].status = 'error';
    jobStore[jobId].error = err.message;
    jobStore[jobId].currentStep = 'error';
    jobStore[jobId].endTime = Date.now();

    await deleteJobFolder(jobId);
  }
});

app.post('/cancel/:jobId', async (req, res) => {
  const jobId = req.params.jobId;
  console.log(`Received cancellation request for job: ${jobId}`);

  const job = jobStore[jobId];
  if (!job) {
    console.log(`Job ${jobId} not found for cancellation`);
    return res.status(404).json({ error: 'Job not found' });
  }

  if (job.status !== 'pending') {
    console.log(`Cannot cancel job ${jobId} with status ${job.status}`);
    return res.status(400).json({ error: 'Job cannot be cancelled in its current state' });
  }

  try {
    job.status = 'canceled';
    job.currentStep = 'canceled';
    job.endTime = Date.now();

    console.log(`Job ${jobId} marked as canceled`);

    await deleteJobFolder(jobId);
    console.log(`Resources cleaned up for canceled job ${jobId}`);

    res.json({ success: true, message: 'Job canceled successfully' });
  } catch (err) {
    console.error(`Error canceling job ${jobId}:`, err);
    res.status(500).json({ error: 'Failed to cancel job', message: err.message });
  }
});

app.get('/status/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  console.log(`Status check for job: ${jobId}`);
  const job = jobStore[jobId];
  if (!job) {
    console.log(`Job ${jobId} not found`);
    return res.status(404).json({ error: 'Job not found' });
  }

  const now = Date.now();
  const elapsedMs = now - job.startTime;
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const elapsedMinutes = elapsedSeconds / 60;

  let speed = 0;
  if (job.completed > 0 && elapsedSeconds > 0) {
    speed = (job.completed / elapsedSeconds) * 60;
  }

  let estimatedTimeRemaining = null;
  if (speed > 0 && job.total > job.completed) {
    const remainingRolls = job.total - job.completed;
    estimatedTimeRemaining = remainingRolls / speed;
  }

  const progressPercent = job.total > 0 ?
    `${Math.round((job.completed / job.total) * 100)}%` : '0%';

  const enhancedResponse = {
    ...job,
    progress: `${job.completed}/${job.total} (${progressPercent})`,
    progressPercent,
    elapsedTime: {
      seconds: elapsedSeconds,
      minutes: elapsedMinutes.toFixed(2),
      formatted: formatTime(elapsedSeconds)
    },
    processingSpeed: {
      rollsPerMinute: speed.toFixed(2)
    },
    estimatedTimeRemaining: estimatedTimeRemaining ?
      {
        minutes: estimatedTimeRemaining.toFixed(2),
        formatted: formatTime(Math.round(estimatedTimeRemaining * 60))
      } : null,
    successfulCount: job.successful.length,
    notFoundCount: job.notFound.length,
    recentSuccessful: job.successful.slice(-10).reverse(),
    recentNotFound: job.notFound.slice(-10).reverse()
  };

  console.log(`Returning enhanced status for job ${jobId}: ${job.status}, progress: ${job.completed}/${job.total}`);
  res.json(enhancedResponse);
});

function formatTime(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [
    hours > 0 ? String(hours).padStart(2, '0') : null,
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0')
  ].filter(Boolean).join(':');
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
