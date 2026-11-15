// 🗄️ Signup-code store — one instance of the shared phone-code store
// factory (services/codeStore.js), table `signup_codes`, with the
// signup-proof columns mirrored (R1c).
const { createCodeStore } = require("./codeStore");

module.exports = createCodeStore("signup_codes", { withProof: true });
