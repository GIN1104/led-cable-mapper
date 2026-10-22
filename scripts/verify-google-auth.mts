import assert from 'node:assert/strict'
import {
  ALLOWED_DRIVE_EMAILS,
  DRIVE_OWNER_EMAIL,
  PUBLIC_GOOGLE_CLIENT_ID,
  googleAccountChooserUrl,
  isAllowedDriveEmail,
  oauthRedirectUri,
  driveUserPermissionUrl,
  permissionAlreadyGranted,
  pickLedExcelFolder,
  readOAuthRedirectResult,
  usePageGoogleLogin,
} from '../src/lib/googleAuth.ts'

assert.deepEqual(
  [...ALLOWED_DRIVE_EMAILS].sort(),
  ['ledvision2026.il@gmail.com', 'starchenkogin@gmail.com'].sort(),
)
assert.equal(isAllowedDriveEmail('ledvision2026.il@gmail.com'), true)
assert.equal(isAllowedDriveEmail(' StarchenkoGin@gmail.com '), true)
for (const blocked of [
  '',
  'other@gmail.com',
  'ledvision2026@gmail.com',
  'ledvision2026.il@gmail.com.evil.com',
  'not-starchenkogin@gmail.com',
  'starchenkogin@gmail.com.il',
]) {
  assert.equal(isAllowedDriveEmail(blocked), false, blocked)
}
assert.equal(DRIVE_OWNER_EMAIL, 'ledvision2026.il@gmail.com')
assert.match(PUBLIC_GOOGLE_CLIENT_ID, /\.apps\.googleusercontent\.com$/)

const redirect = oauthRedirectUri('https://gin1104.github.io', '/led-cable-mapper/')
assert.equal(redirect, 'https://gin1104.github.io/led-cable-mapper/')

const chooser = new URL(
  googleAccountChooserUrl({
    clientId: PUBLIC_GOOGLE_CLIENT_ID,
    redirectUri: redirect,
    state: 'abc',
  }),
)
assert.equal(chooser.searchParams.get('prompt'), 'select_account')
assert.equal(chooser.searchParams.get('response_type'), 'token')
assert.equal(chooser.searchParams.get('client_id'), PUBLIC_GOOGLE_CLIENT_ID)
assert.equal(chooser.searchParams.get('redirect_uri'), redirect)
assert.equal(chooser.searchParams.get('login_hint'), null)
assert.equal(chooser.searchParams.get('state'), 'abc')

const parsed = readOAuthRedirectResult('#access_token=ya29.token&expires_in=3600&state=abc&token_type=Bearer')
assert.equal(parsed?.token, 'ya29.token')
assert.equal(parsed?.expiresIn, 3600)
assert.equal(parsed?.state, 'abc')
assert.equal(readOAuthRedirectResult('#trip_id=1'), null)

const folder = pickLedExcelFolder([
  { id: 'mine', name: 'Excel', ownerEmail: 'starchenkogin@gmail.com', parentName: 'LED Warehouse' },
  { id: 'owner-other', name: 'Excel', ownerEmail: 'ledvision2026.il@gmail.com', parentName: 'Other' },
  { id: 'owner', name: 'Excel', ownerEmail: 'ledvision2026.il@gmail.com', parentName: 'LED Warehouse' },
])
assert.equal(folder, 'owner')
assert.equal(pickLedExcelFolder([]), null)

assert.equal(usePageGoogleLogin({ userAgent: 'TelegramBot', telegram: false }), true)
assert.equal(
  usePageGoogleLogin({
    userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile',
    telegram: false,
  }),
  false,
)

const shareUrl = new URL(driveUserPermissionUrl('folder id'))
assert.equal(shareUrl.searchParams.get('sendNotificationEmail'), 'false')
assert.equal(
  permissionAlreadyGranted(
    [{ emailAddress: 'StarchenkoGin@gmail.com', role: 'writer' }],
    'starchenkogin@gmail.com',
  ),
  true,
)
assert.equal(
  permissionAlreadyGranted([{ emailAddress: 'starchenkogin@gmail.com', role: 'reader' }], 'starchenkogin@gmail.com'),
  false,
)

console.log('google auth checks ok')
