# ResultJano - Bulk Exam Result Fetcher

ResultJano is a high-performance web application that automates the process of retrieving and merging multiple student exam results from MBM University's official result portal ([mbmiums.in](https://mbmiums.in)). It allows users to fetch results for a range of roll numbers, merge them into a single consolidated PDF, and download or preview the final document in the browser.

## Features

- **Parallel Processing**: Multi-tab parallel browser contexts for fast bulk scraping (~3x-35x speedup).
- **Custom Speed Modes**: Choose from Very Fast (3s), Fast (5s), Medium (10s), or Slow/Low (20s) timeouts to match your internet connection.
- **Academic Year Support**: Full support for 2025-26, 2024-25, 2023-24, and 2022-23 exam sessions.
- **Flexible Roll Numbers**: Supports 10-digit, 11-digit, or arbitrary roll number lengths with automatic prefix matching.
- **Smart Branch Matching**: Accurate branch recognition (including EEE and EE distinction).
- **Real-Time Progress**: Live status dashboard tracking processed roll numbers, processing speed, and status logs.
- **Automatic PDF Merging**: Merges all fetched individual result PDFs into one clean document.
- **Job Cancellation & Auto Cleanup**: Cancel running jobs anytime with automatic temporary file cleanup.

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) (v14 or higher)
- npm or yarn

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/Er-Mayank-Aggarwal/ResultJano.git
   cd ResultJano
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Directory structure (auto-created on first run):
   - `downloads/` - Temporary storage for downloaded individual PDFs
   - `merged/` - Storage for combined PDF result files
   - `public/` - Static files for the web interface

## Usage

1. Start the application:
   ```bash
   npm start
   ```

2. Open your browser and navigate to:
   ```
   http://localhost:5002
   ```

3. Fill in the required details:
   - **Academic Year** (e.g., 2025-26)
   - **Exam Type** (Normal, Revaluation, Makeup)
   - **Semester**
   - **Branch**
   - **Internet Speed Mode** (Very Fast 3s, Fast 5s, Medium 10s, Slow 20s)
   - **Start & End Roll Numbers**

4. Click **Generate PDF** to start processing.
5. Monitor real-time progress and download the merged PDF once complete.

## Configuration

The server runs on port `5002` by default. You can change this using the `PORT` environment variable:

```bash
PORT=8080 npm start
```

## Technical Details

### Technologies Used

- **Backend**: Node.js, Express.js
- **Web Automation**: Puppeteer (Headless, Isolated Browser Contexts)
- **PDF Manipulation**: pdf-lib
- **Frontend**: HTML5, Vanilla JavaScript, Tailwind CSS

### Project Structure

- `server.cjs` - Express server and multi-tab automation logic
- `public/` - Web interface frontend (HTML, CSS, JavaScript)
- `utils/mergePDFs.cjs` - Utility for merging PDF documents
- `downloads/` - Temporary download folder
- `merged/` - Output directory for merged result PDFs

## Limitations

- Maximum roll number range per job is set to 200 to prevent server overload.
- Start and end roll numbers must belong to the same branch and semester.
- **Target Site**: Designed specifically for scraping results from MBM University's portal ([mbmiums.in](https://mbmiums.in)).

## Authors

Developed by:
- **Mayank Aggarwal** (CSE 2027)
- **Hemang Choudhary** (IT 2027)

## License

This project is licensed under the MIT License - see the LICENSE file for details.
