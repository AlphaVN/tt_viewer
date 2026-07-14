import fs from "fs";

const data = JSON.parse(fs.readFileSync("universal_data.json", "utf8"));

function findKeys(obj, prefix = "") {
  if (!obj || typeof obj !== "object") return;
  
  for (const key of Object.keys(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (key.toLowerCase().includes("video") || key.toLowerCase().includes("post") || key.toLowerCase().includes("item") || key.toLowerCase().includes("playcount")) {
      console.log(`Found matching key: ${path} (type: ${typeof obj[key]})`);
      if (Array.isArray(obj[key])) {
        console.log(`  Array length: ${obj[key].length}`);
        if (obj[key].length > 0) {
          console.log(`  First item keys:`, Object.keys(obj[key][0]));
        }
      }
    }
    if (obj[key] && typeof obj[key] === "object") {
      // Limit recursion depth to avoid infinite loop or too much output
      if (path.split(".").length < 6) {
        findKeys(obj[key], path);
      }
    }
  }
}

findKeys(data);
