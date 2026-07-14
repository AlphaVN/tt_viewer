import fs from "fs";

const data = JSON.parse(fs.readFileSync("universal_data.json", "utf8"));
const userDetail = data.__DEFAULT_SCOPE__["webapp.user-detail"];
console.log("userInfo keys:", Object.keys(userDetail.userInfo));
console.log("itemList:", userDetail.userInfo.itemList);
console.log("stats:", userDetail.userInfo.stats);
console.log("statsV2:", userDetail.userInfo.statsV2);
