// 📲 Login phone verification — phone-login OTP codes (R1h).
//
// Same code machinery as signup (services/phoneCode.js: 6 digits,
// salted SHA-256 hash, 10-min TTL, 5 wrong attempts kills the code,
// max 3 codes/hour per phone) but a SEPARATE namespace: login codes
// live in their own store keyed by phone (services/loginCodeStore.js,
// table `login_codes`), so a signup code can never verify a login
// and vice versa. The code proves phone ownership only; the route
// then returns the account email — never before the code verifies.
const { normalizePhone } = require("./sms");
const { createPhoneCodeService } = require("./phoneCode");
const store = require("./loginCodeStore");

const { issuePhoneCode, verifyPhoneCode } = createPhoneCodeService(store);

module.exports = {
  issueLoginCode: issuePhoneCode,
  verifyLoginCode: verifyPhoneCode,
  // Test seams only.
  _hasPending: (phone) => {
    const clean = normalizePhone(phone);
    if (!clean) return false;
    const rec = store._peek(clean);
    return !!rec?.verification;
  },
  _clearMemory: () => store._clearMemory(),
};
