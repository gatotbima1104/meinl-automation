import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { google } from "googleapis";
import { setTimeout } from "timers/promises";
import fs from "fs";
import * as dotenv from "dotenv";
import chromium from "@sparticuz/chromium";  // Deployment setup

// Pull environment
dotenv.config();
puppeteer.use(StealthPlugin());

// Pull credentials
const email = process.env.EMAIL;
const password = process.env.PASSWORD;
const credential_path = "./credential.json";
const spreadSheet_ID = process.env.SPREADSHEET_ID;
// const range_column = `${process.env.SHEET_NAME}!A:B`;
const sheetNames = process.env.SHEET_NAMES.split(","); // Multiple sheet names
const loginUrl = "https://b2b.meinl.de/Account/Login";

// Function Authorize Google
async function authorize() {
  const content = fs.readFileSync(credential_path);
  const credentials = JSON.parse(content);

  const authClient = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return authClient.getClient();
}

// Function Read SpreadSheet
async function readSpreadsheet(auth, sheetName) {
  const sheets = google.sheets({
    version: "v4",
    auth,
  });

  const range_column = `${sheetName}!A:B`; // Dynamic range based on sheetName

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadSheet_ID,
    range: range_column,
  });

  const rows = response.data.values;
  if (rows.length) {
    return rows.slice(1).map((row) => ({
      code: row[0],
      availability: row[1],
    }));
  } else {
    throw new Error("No data found.");
  }
}

// Function Write SpreadSheet
async function writeSpreadsheet(auth, sheetName, values) {
  const sheets = google.sheets({
    version: "v4",
    auth,
  });

  // Formatted values
  const formattedValues = values.map(({ code, availability }) => [code, availability]);

  await sheets.spreadsheets.values.update({
    auth,
    spreadsheetId: spreadSheet_ID,
    // range: `${process.env.SHEET_NAME}!A2:B`,
    range: `${sheetName}!A2:B`,
    valueInputOption: "USER_ENTERED",
    resource: {
      values: formattedValues,
    },
  });
}

// Function login
async function login(page, email, password, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // const existCookies = fs.existsSync("./cookies.json");
      // if (!existCookies) {
      //   console.log("Cookies not found, logging in ...");
        console.log("logging in ...");
        await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
        await setTimeout(2000);
  
        await page.waitForSelector('input[autocomplete="username"]', {
          visible: true,
        });
        await page.type('input[autocomplete="username"]', email, { delay: 300 });
        await page.waitForSelector('input[autocomplete="current-password"]', {
          visible: true,
        });
        await page.type('input[autocomplete="current-password"]', password, {
          delay: 300,
        });
        await page.click("div.login-button");
  
        // await page.waitForNavigation({ waitUntil: "domcontentloaded" });
        await setTimeout(5000)
  
        const loginFailedSelector = await page.$("div.alert-danger"); // Check if login failed
        if (loginFailedSelector) {
          console.log("Credentials are wrong or login failed ...");
          return false;
        }
        console.log("Login Successfully ...");
  
      //   const cookies = await page.cookies();
      //   fs.writeFileSync("./cookies.json", JSON.stringify(cookies, null, 2));
      //   console.log("Cookies saved, Login Successfully ...");
      // } else {
      //   const cookiesString = fs.readFileSync("./cookies.json");
      //   const cookies = JSON.parse(cookiesString);
      //   await page.setCookie(...cookies);
      //   console.log("Cookies found, Login Successfully ...");
      // }
  
      return true;
    } catch (error) {
      console.log(`Attempt ${attempt} failed: ${error.message}`);
  
        if (attempt === maxRetries) {
          console.log("Max retries reached. Login failed.");
          return false;
        }
  
        console.log("Retrying login ...");
        await page.reload({ waitUntil: "networkidle2" }); // R
    }
  }
}

// Input code
async function searchCode(page, selector, value, button) {
  await page.type(selector, value, { delay: 100 });

  await page.waitForSelector(button);
  await page.click(button);
  await page.waitForNavigation();
}

// Random delay
function randomDelay(min, max) {
  return Math.random() * (max - min) + min;
}

/*
  Deployment Setup
*/

async function main() {
  try {
    // Deploying setup browser
    const browser = await puppeteer.launch({
      args: chromium.args,
      // defaultViewport: chromium.defaultViewport,
      defaultViewport: null,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    // Deploying set viewPort browser
    await page.setViewport({
      width: 1366,
      height: 768,
    });

    // Read spreadsheet
    const auth = await authorize();

    // Login
    let isLoginSuccessfully = await login(page, email, password);
    if (!isLoginSuccessfully) {
      return;
    }

    // Loop through each sheet
  for (const sheetName of sheetNames) {
    console.log(`Processing sheet: ${sheetName}`);

    let items;
      try {
        items = await readSpreadsheet(auth, sheetName);
      } catch (error) {
        if (error.message.includes("Unable to parse range")) {
          console.log(`Sheet "${sheetName}" not found. Skipping...`);
          continue; // Skip to the next sheet if not found
        } else {
          throw error; // Rethrow any other unexpected errors
        }
      }
    // const items = await readSpreadsheet(auth, sheetName);
    const codes = items.map((item) => item.code);
    const codeAvailabilityMap = new Map(items.map(({ code, availability }) => [code, availability]));

    // Loop codes
    for (let code of codes) {
      let retries = 0;
      let maxRetries = 3;
      let codeLoaded = false;

      // Retry codes if not loaded
      while (retries < maxRetries && !codeLoaded) {
        try {          
          // Search code
          console.log(`Checking code: ${code} (Sheet: ${sheetName}, Attempt: ${retries + 1})`);
          await page.waitForSelector('input[type="search"]');
          await page.evaluate(
            () => (document.querySelector('input[type="search"]').value = "")
          );
          await searchCode(
            page,
            'input[type="search"]',
            code,
            "button.como-search-btn"
          );
          await setTimeout(randomDelay(2, 3) * 1000);
  
          // Wait for product tile or check if alert for no product
          const productTileExists = await page
            .waitForSelector("div.como-prod-tile-st-wrapper", { timeout: 5000 })
            .catch(() => null);
          await setTimeout(2000);
  
          if (!productTileExists) {
            // If the selector is not found, check if there's an alert indicating no product
            const productNotFound = await page.$("div.alert.alert-info");
            if (productNotFound) {
              codeAvailabilityMap.set(code, "Not Found");
              codeLoaded = true; // Stop retrying if code is not found
            } else {
              codeAvailabilityMap.set(code, "Not loaded");
              retries++; // Increment retry counter
              if (retries >= maxRetries) {
                console.log(`Max retries reached for code: ${code}`);
                codeLoaded = true; // Stop retrying after max retries
              }
            }
          } else {
            const statusAvailable = await page.evaluate(() => {
              const statusSelector = document.querySelector(
                'span[style="text-decoration: underline;"]'
              );
              return statusSelector ? statusSelector.textContent : "Not Available";
            });

            codeAvailabilityMap.set(code, statusAvailable);
            codeLoaded = true; // Code loaded successfully, no more retries needed
          }
        } catch (error) {
          console.log(error);
          retries++; // Increment retry counter if an error occurs
          if (retries >= maxRetries) {
            codeAvailabilityMap.set(code, "Code Error or Not Found");
            codeLoaded = true; // Stop retrying after max retries even on error
          }
        }
      }
    }

    // Convert the map to arrays for writing
    const formattedResults = Array.from(
      codeAvailabilityMap,
      ([code, availability]) => ({ code, availability })
    );

    await writeSpreadsheet(auth, sheetName, formattedResults);
    console.log(`Finished processing sheet: ${sheetName}`);
  }
    console.log("All codes tracked successfully");
    await browser.close();
  } catch (error) {
    console.log(error);
  }
}

export const handler = async (event) => {
  try {
    await main();
    const response = {
      statusCode: 200,
      body: JSON.stringify("All Products Loaded !!"),
    };
    return response;
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify("Failed to Load Products !"),
    };
  }
};

/*
  End
*/
