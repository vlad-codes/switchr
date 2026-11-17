"""Exercise the real extension in a fresh Firefox profile with synthetic cookies."""

import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time


ROOT = Path(__file__).resolve().parents[1]
FIREFOX = os.environ.get("FIREFOX_BINARY", "firefox")
ADDON_ID = "switchr@vlad-codes"


class Marionette:
    def __init__(self, connection):
        self.connection = connection
        self.stream = connection.makefile("rb")
        self.sequence = 0
        self.read()

    def read(self):
        size = bytearray()
        while (byte := self.stream.read(1)) != b":":
            if not byte:
                raise EOFError("Firefox closed the Marionette connection")
            size.extend(byte)
        return json.loads(self.stream.read(int(size)))

    def call(self, name, **params):
        self.sequence += 1
        packet = json.dumps([0, self.sequence, name, params]).encode()
        self.connection.sendall(str(len(packet)).encode() + b":" + packet)
        _, sequence, error, result = self.read()
        assert sequence == self.sequence
        if error:
            raise RuntimeError(error)
        return result.get("value", result) if isinstance(result, dict) else result

    def script(self, script, *args):
        return self.call("WebDriver:ExecuteAsyncScript", script=script, args=args)


TEST_SCRIPT = """
const done = result => { document.title = 'SWITCHR-QA:' + JSON.stringify(result); };
const url = 'https://www.twitch.tv/';
const send = (type, payload) => browser.runtime.sendMessage({ type, payload });
const expect = (value, message) => { if (!value) throw Error(message); };
const login = async name => {
  for (const [key, value] of [['auth-token', 'synthetic-' + name], ['login', name]]) {
    await browser.cookies.set({ url, name: key, value, secure: true });
  }
};
(async () => {
  await login('alice');
  const alice = await send('SAVE_CURRENT');
  expect(alice.ok && alice.slot.login === 'alice', JSON.stringify(alice));
  const begin = await send('BEGIN_LOGIN', {});
  expect(begin.ok, JSON.stringify(begin));
  expect(!(await browser.cookies.get({ url, name: 'auth-token' })), 'Login did not clear cookies');
  await login('bob');
  const bob = await send('COMPLETE_LOGIN');
  expect(bob.ok && bob.slot.login === 'bob', JSON.stringify(bob));
  for (const [name, saved] of [['alice', alice], ['bob', bob]]) {
    const switched = await send('SWITCH_TO_SLOT', { slotId: saved.slot.id });
    expect(switched.ok, JSON.stringify(switched));
    const cookie = await browser.cookies.get({ url, name: 'auth-token' });
    expect(cookie?.value === 'synthetic-' + name, 'Wrong active cookie');
  }
  const state = await send('GET_STATE');
  expect(state.activeSlotId === bob.slot.id && state.slots.length === 2, 'Wrong account state');
  expect(!JSON.stringify(state).includes('synthetic-'), 'Credentials in state response');
  expect(!(await browser.storage.local.get('slots')).slots, 'Credentials in shared storage');
  done({ ok: true });
})().catch(error => done({ error: String(error) }));
"""

with tempfile.TemporaryDirectory(prefix="switchr-firefox-") as directory:
    addon = Path(directory, 'addon')
    addon.mkdir()
    shutil.copy2(ROOT / 'manifest.json', addon)
    for folder in ('background', 'content', 'icons', 'popup'):
        shutil.copytree(ROOT / folder, addon / folder)
    popup = addon / 'popup' / 'popup.html'
    popup.write_text(popup.read_text(encoding='utf-8').replace(
        '</body>', '<script src="firefox-qa.js"></script></body>'
    ), encoding='utf-8')
    (popup.parent / 'firefox-qa.js').write_text(
        f"(() => {{\n{TEST_SCRIPT}\n}})();", encoding='utf-8'
    )
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    Path(directory, "user.js").write_text(
        f'user_pref("marionette.port", {port});\n'
        'user_pref("network.proxy.type", 1);\n'
        'user_pref("network.proxy.http", "127.0.0.1");\n'
        'user_pref("network.proxy.http_port", 1);\n'
        'user_pref("network.proxy.ssl", "127.0.0.1");\n'
        'user_pref("network.proxy.ssl_port", 1);\n',
        encoding="utf-8",
    )
    launcher_flags = ["-wait-for-browser"] if sys.platform == "win32" else []
    process = subprocess.Popen([
        FIREFOX, "-headless", "-no-remote", "-profile", directory,
        "-marionette", *launcher_flags,
    ], env={**os.environ, "MOZ_REMOTE_ALLOW_SYSTEM_ACCESS": "1"})
    try:
        deadline = time.monotonic() + 20
        while True:
            try:
                connection = socket.create_connection(("127.0.0.1", port), timeout=10)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.25)
        with connection:
            driver = Marionette(connection)
            driver.call("WebDriver:NewSession", capabilities={"pageLoadStrategy": "none"})
            driver.call("Addon:Install", path=str(addon), temporary=True)
            driver.call("Marionette:SetContext", value="chrome")
            driver.script("""
                const [id, done] = arguments;
                const url = WebExtensionPolicy.getByID(id).getURL('popup/popup.html');
                window.switchrQaTab = window.gBrowser.addTrustedTab(url);
                done(true);
            """, ADDON_ID)
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                title = driver.script("""
                    const tab = window.switchrQaTab;
                    arguments[0](tab.linkedBrowser.contentTitle || tab.label || '');
                """)
                if title.startswith("SWITCHR-QA:"):
                    result = json.loads(title.removeprefix("SWITCHR-QA:"))
                    break
                time.sleep(0.25)
            else:
                raise AssertionError(f"Firefox test did not finish, tab title: {title!r}")
            assert result == {"ok": True}, result
            print("Firefox: saved two accounts and restored both sessions")
            driver.call("Marionette:Quit", flags=["eForceQuit"])
    finally:
        if process.poll() is None:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
