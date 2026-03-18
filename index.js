const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

async function scrapeSpysOne() {
    console.log('Starting scraper...');

    // Configure Puppeteer to run in GitHub Actions (headless & no sandbox)
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-extensions',
            '--disable-sync',
            '--disable-translate',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-first-run',
            '--safebrowsing-disable-auto-update',
            '--ignore-certificate-errors',
            '--ignore-ssl-errors',
            '--ignore-certificate-errors-spki-list',
        ]
    });

    try {
        const page = await browser.newPage();

        // Set a realistic User-Agent string
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });

        console.log('Navigating to https://spys.one/en/socks-proxy-list/');
        // Use an extended timeout in case the website is slow to load
        await page.goto('https://spys.one/en/socks-proxy-list/', { waitUntil: 'domcontentloaded', timeout: 60000 });

        console.log('Waiting for the proxy table to appear...');
        // Wait for the table rows with class spy1xx or spy1x
        await page.waitForSelector('table tr.spy1xx, table tr.spy1x', { timeout: 30000 });

        // Attempt to change the view to "500 per page" if possible
        try {
            // Must fire select and waitForNavigation concurrently — select triggers navigation
            // immediately, so calling waitForNavigation after would miss it (context destroyed).
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
                page.select('#xpp', '5'), // The value '5' usually means 500 items on spys.one
            ]);
            // Give the page a moment to fully settle after navigation
            await new Promise(resolve => setTimeout(resolve, 2000));
            console.log('Successfully changed the view to 500 proxies per page.');
        } catch (e) {
            console.log('Failed to change the items per page dropdown, proceeding with the default view.');
        }

        console.log('Starting data extraction...');
        const proxies = await page.evaluate(() => {
            const rows = document.querySelectorAll('tr.spy1xx, tr.spy1x');
            const data = [];

            rows.forEach(row => {
                const cols = row.querySelectorAll('td');
                // Ensure we have enough columns (spys.one max 9-10 cols)
                if (cols.length >= 9) {
                    const ipPortStr = cols[0].innerText.trim();
                    const typeStr = cols[1].innerText.trim();
                    const anonymity = cols[2].innerText.trim();
                    let country = cols[3].innerText.trim();
                    let hostname = cols[4].innerText.trim();
                    let latency = cols[5].innerText.trim();

                    // The table layout can sometimes shift columns based on what data is available.
                    // We can locate Uptime by looking for '%' and Check Date by finding 'ago)' or a year
                    let uptime = "";
                    let checkDate = "";

                    // Check cols 6 to cols.length-1 for the right fields
                    for (let j = 6; j < cols.length; j++) {
                        let text = cols[j].innerText.trim().replace(/\n/g, ' ');
                        if (text.includes('%') && text.includes('(')) {
                            uptime = text;
                        } else if (text.includes('ago)') || text.match(/[0-9]{4}/)) {
                            checkDate = text;
                        }
                    }

                    // Fallbacks if logic above fails, use standard indices assuming normal structure
                    if (!uptime && cols[7]) uptime = cols[7].innerText.trim().replace(/\n/g, ' ');
                    if (!checkDate && cols[8]) checkDate = cols[8].innerText.trim().replace(/\n/g, ' ');

                    // Make sure the format is a pure IP:Port
                    if (ipPortStr.match(/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:[0-9]+/)) {
                        data.push({
                            ipPort: ipPortStr,
                            type: typeStr,
                            anonymity: anonymity,
                            country: country.replace(/\n/g, ' '), // Remove newlines from country names
                            latency: latency,
                            uptime: uptime,
                            checkDate: checkDate
                        });
                    }
                }
            });

            return data;
        });

        console.log(`Successfully extracted ${proxies.length} proxies.`);

        if (proxies.length === 0) {
            console.warn('No proxy data found, aborting process.');
            return;
        }

        // Format output to Markdown
        // Get the current time using WIB (UTC+7) timezone to log in the file
        const dateOpts = { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' };
        const formatter = new Intl.DateTimeFormat('en-GB', dateOpts); // Using en-GB for DD/MM/YYYY
        const timestampWib = formatter.format(new Date()).replace(',', '');

        let mdContent = `# Spys.one SOCKS Proxy List\n\n`;
        mdContent += `> Scraped automatically via GitHub Actions.\n\n`;
        mdContent += `**Last Updated:** ${timestampWib} WIB\n\n`;
        mdContent += `**Total Proxies:** ${proxies.length}\n\n`;

        mdContent += `| Proxy (IP:Port) | Type | Anonymity | Country | Latency | Uptime | Check Date |\n`;
        mdContent += `| --- | --- | --- | --- | --- | --- | --- |\n`;

        proxies.forEach(p => {
            mdContent += `| \`${p.ipPort}\` | ${p.type} | ${p.anonymity} | ${p.country} | ${p.latency} | ${p.uptime} | ${p.checkDate} |\n`;
        });

        // Save to proxies.md
        const outputPath = path.join(__dirname, 'proxies.md');
        fs.writeFileSync(outputPath, mdContent, 'utf-8');
        console.log(`Successfully saved results to ${outputPath}`);

    } catch (err) {
        console.error('An error occurred during scraping:', err.message);
        process.exit(1);
    } finally {
        // Make sure the browser is closed
        await browser.close();
    }
}

scrapeSpysOne();
