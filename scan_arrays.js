import fs from "fs";

const data = JSON.parse(fs.readFileSync("universal_data.json", "utf8"));

function searchForArrays(obj, path = "") {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    if (obj.length > 0) {
      console.log(`Found array at ${path} with length ${obj.length}`);
      console.log("  Sample item:", JSON.stringify(obj[0]).substring(0, 200));
    }
    return;
  }
  for (const [key, value] of Object.entries(obj)) {
    searchForArrays(value, path ? `${path}.${key}` : key);
  }
}

searchForArrays(data);
