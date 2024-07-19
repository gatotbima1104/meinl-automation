import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { google } from "googleapis";
import { setTimeout } from "timers/promises";
import fs from "fs";
import * as dotenv from "dotenv";

// Pull environment
dotenv.config();
puppeteer.use(StealthPlugin());

// Pull credenetials
const email = process.env.EMAIL;
const password = process.env.PASSWORD;
const credential_path = "./credential.json";
const spreadSheet_ID = process.env.SPREADSHEET_ID;
const range_column = `${process.env.SHEET_NAME}!A:B`;
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
async function readSpreadsheet(auth) {
  const sheets = google.sheets({
    version: "v4",
    auth,
  });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadSheet_ID,
    range: range_column,
  });

  const rows = response.data.values;
  if (rows.length) {
    return rows.slice(1).map((row) => ({
      code: row[0],
    }));
  } else {
    throw new Error("No data found.");
  }
}

// Function Write SpreadSheet
async function writeSpreadsheet(auth, values) {
  const sheets = google.sheets({
    version: "v4",
    auth,
  });

  const formattedValues = values.map((value) => [value]);

  await sheets.spreadsheets.values.append({
    auth,
    spreadsheetId: spreadSheet_ID,
    range: `${process.env.SHEET_NAME}!B2`,
    valueInputOption: "USER_ENTERED",
    resource: {
      values: formattedValues,
    },
    
  });
}

// Function login
async function login(page, email, password) {
  try {
    // const existCookies = JSON.parse(
    //   fs.existsSync("./cookies.json")
    // );
    // if (!existCookies) {
      // console.log("Cookies not found, logging in ...");
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

      await page.waitForNavigation({ waitUntil: "domcontentloaded" });

      const loginFailedSelector = await page.$("div.alert-danger"); // Check if login failed
      if (loginFailedSelector) {
        console.log("Credentials are wrong or login failed ...");
        return;
      }
      console.log("Login Successfully ...");

      // const cookies = await page.cookies();
      // fs.writeFileSync(
      //   "./cookies.json",
      //   JSON.stringify(cookies, null, 2)
      // );
      // console.log("Cookies saved, Login Successfully ...");
    // } else {
    //   const cookiesString = fs.readFileSync("./cookies.json");
    //   const cookies = JSON.parse(cookiesString);
    //   await page.setCookie(...cookies);
    //   console.log("Cookies found, Login Successfully ...");
    // }

    return true;
  } catch (error) {
    console.log(error);
    return false;
  }
}

// Input code
async function searchCode(page, selector, value, button) {
  await page.type(selector, value, { delay: 200 });

  await page.waitForSelector(button);
  await page.click(button);
  await page.waitForNavigation();
}

// Random delay
function randomDelay(min, max) {
  return Math.random() * (max - min) + min;
}

(async () => {
  try {
    const browser = await puppeteer.launch({
      headless: "new",
      args: [`--no-sandbox`],
      defaultViewport: {
        width: 1366,
        height: 768,
      },
    });
    const page = await browser.newPage()

    // Read spreadsheet
    const auth = await authorize();
    const items = await readSpreadsheet(auth);
    const codes = items.map((item) => item.code);

    // Login
    let isLoginSuccessfully = await login(page, email, password)
    if(!isLoginSuccessfully){
        return;
    }

    // Main pages
    await page.goto(loginUrl, {waitUntil: 'domcontentloaded'})
    await setTimeout(2000)

    // Loop codes
    let result = []
    let index = 1;
    for (let code of codes) {
      try {
        // Search code
        console.log(`Checking code : ${index}`);
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

        // Alternative handle product
        // const itemsSelector = 'div.como-prod-tile-st-wrapper > section'
        // await page.waitForSelector(itemsSelector, {timeout: 10000})
        // const items = await page.evaluate(()=> {
        //   const itemsSelector  = document.querySelectorAll('div.como-prod-tile-st-wrapper > section')
        //   return itemsSelector? itemsSelector.length : 0
        // })

        // if(!items || items.length === 0){
        //   console.log(`=== Item not found`)
        //   continue;
        // }

        const productNotfound = await page.$("div.alert.alert-info");
        if (productNotfound) {
          result.push("Not Found");
          continue;
        }

        const statusAvailable = await page.evaluate(() => {
          const statusSelector = document.querySelector(
            'span[style="text-decoration: underline;"]'
          );
          return statusSelector ? statusSelector.textContent : "";
        });

        result.push(statusAvailable);
        index++;
      } catch (error) {
        console.log(error);
      }
    }

    await writeSpreadsheet(auth, result);
    console.log("All codes tracked successfully");
    await browser.close();
  } catch (error) {
    console.log(error);
  }
})();
