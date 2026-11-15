// 🗄️ Login-code store — one instance of the shared phone-code store
// factory (services/codeStore.js), table `login_codes`. Separate
// namespace from signup codes: a login code can never verify a
// signup and vice versa (same code math, different store).
const { createCodeStore } = require("./codeStore");

module.exports = createCodeStore("login_codes");
