import axios from "axios";

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
];

function getRandomUserAgent() {
  return USER_AGENTS[0];
}

function extractScriptJson(html, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<script\\b(?=[^>]*\\bid\\s*=\\s*["']${escapedId}["'])[^>]*>([\\s\\S]*?)<\\/script>`,
    "i",
  );
  const match = html.match(pattern);
  if (!match) return null;
  return JSON.parse(match[1].trim());
}

async function run() {
  const username = "khanhiattm2";
  const url = `https://www.tiktok.com/@${username}`;
  console.log("Fetching", url);
  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": getRandomUserAgent(),
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      }
    });
    const html = response.data;
    console.log("HTML length:", html.length);
    
    const universalData = extractScriptJson(html, "__UNIVERSAL_DATA_FOR_REHYDRATION__");
    if (universalData) {
      console.log("Found __UNIVERSAL_DATA_FOR_REHYDRATION__");
      console.log("Top-level keys:", Object.keys(universalData));
      if (universalData.__DEFAULT_SCOPE__) {
        console.log("Default scope keys:", Object.keys(universalData.__DEFAULT_SCOPE__));
        const userDetail = universalData.__DEFAULT_SCOPE__["webapp.user-detail"];
        if (userDetail) {
          console.log("UserDetail keys:", Object.keys(userDetail));
        }
      }
      import("fs").then(fs => {
        fs.writeFileSync("universal_data.json", JSON.stringify(universalData, null, 2));
        console.log("Saved universal_data.json");
      });
    } else {
      console.log("__UNIVERSAL_DATA_FOR_REHYDRATION__ not found.");
    }

    const nextData = extractScriptJson(html, "__NEXT_DATA__");
    if (nextData) {
      console.log("Found __NEXT_DATA__");
      import("fs").then(fs => {
        fs.writeFileSync("next_data.json", JSON.stringify(nextData, null, 2));
        console.log("Saved next_data.json");
      });
    } else {
      console.log("__NEXT_DATA__ not found.");
    }

  } catch (err) {
    console.error("Error:", err.message);
  }
}

run();
