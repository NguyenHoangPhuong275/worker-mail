"""Run against an isolated local Worker. No external mail is sent."""
import concurrent.futures
import email.message
import email.utils
import time
import json
import os
from pathlib import Path
import urllib.request
import urllib.error
import uuid

BASE = os.environ.get("MAIL_TEST_URL", "http://127.0.0.1:8793")
TOKEN = next(line.split("=", 1)[1].strip() for line in Path(".env").read_text().splitlines() if line.startswith("API_AUTH_TOKEN="))
recipient = "e2e-" + uuid.uuid4().hex[:10] + "@kenjaku.online"

def api(path):
    req = urllib.request.Request(BASE + path, headers={"Authorization": "Bearer " + TOKEN})
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.load(response)

def deliver(subject, text=None, html=None, attachment=False, blank_sender=False, minutes_ago=0):
    message = email.message.EmailMessage()
    message["From"] = "Example Sender <hello@example.com>"
    message["To"] = recipient
    message["Subject"] = subject
    message["Message-ID"] = "<" + uuid.uuid4().hex + "@local-test.invalid>"
    message["Date"] = email.utils.formatdate(time.time() - minutes_ago * 60, usegmt=True)
    if text is not None: message.set_content(text)
    else: message.set_content("HTML message")
    if html is not None: message.add_alternative(html, subtype="html")
    if attachment: message.add_attachment(b"attachment bytes", maintype="application", subtype="octet-stream", filename="example.bin")
    sender = "" if blank_sender else "hello@example.com"
    url = BASE + "/cdn-cgi/local/email?from=" + sender + "&to=" + recipient
    request = urllib.request.Request(url, data=message.as_bytes(), headers={"Content-Type": "message/rfc822"}, method="POST")
    with urllib.request.urlopen(request, timeout=30) as response: assert response.status == 200

assert api("/api/mail/messages?to=" + recipient)["messages"] == []
deliver("Ordinary mail", text="A normal email without OTP.")
snapshot = api("/api/mail/messages?to=" + recipient)
assert len(snapshot["messages"]) == 1 and snapshot["data"]["text"].strip() == "A normal email without OTP."
assert snapshot["data"]["from"] == "Example Sender <hello@example.com>"
deliver("HTML and attachment", text=None, html="<h1>Newsletter</h1><p>HTML body</p>", attachment=True)
snapshot = api("/api/mail/messages?to=" + recipient)
assert len(snapshot["messages"]) == 2 and "<h1>Newsletter</h1>" in snapshot["data"]["html"]
assert snapshot["data"]["attachments"][0]["filename"] == "example.bin"
large = "Tiếng Việt 🎉 " * 30000
deliver("Large unicode mail", text=large)
snapshot = api("/api/mail/messages?to=" + recipient)
assert snapshot["data"]["text"].strip() == large.strip()
deliver("Verify your email", text="Your verification code: 123456. Expires in 10 minutes.")
snapshot = api("/api/mail/messages?to=" + recipient)
assert snapshot["data"]["otp"] == "123456" and snapshot["data"]["verification"]["purpose"] == "email"
assert snapshot["data"]["verification"]["expiresAt"] is not None
deliver("Welcome, personal discount unlocked", text="6000+ generations. Your personal code: 555555. Claim your 55% discount.")
snapshot = api("/api/mail/messages?to=" + recipient)
assert snapshot["data"]["otp"] is None and snapshot["data"]["verification"]["status"] == "none"
deliver("Sign in", text="Your OTP codes: 123456 or 654321")
snapshot = api("/api/mail/messages?to=" + recipient)
assert snapshot["data"]["otp"] is None and snapshot["data"]["verification"]["status"] == "ambiguous"
deliver("Sign in", text="Your OTP code is 123456. Expires in 10 minutes.", minutes_ago=20)
snapshot = api("/api/mail/messages?to=" + recipient)
assert snapshot["data"]["otp"] is None and snapshot["data"]["verification"]["status"] == "expired"
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
    list(pool.map(lambda i: deliver("Concurrent " + str(i), text="Concurrent email " + str(i)), range(5)))
snapshot = api("/api/mail/messages?to=" + recipient)
assert len(snapshot["messages"]) == 12
for row in snapshot["messages"]:
    detail = api("/api/mail/message?to=" + recipient + "&id=" + row["id"])
    assert detail["data"]["id"] == row["id"] and detail["data"]["to"] == recipient
assert api("/api/mail/messages?to=" + recipient)["messages"] == snapshot["messages"]
assert api("/api/mail/messages?to=other-" + uuid.uuid4().hex[:8] + "@kenjaku.online")["messages"] == []
print("PASS: delivery/read, HTML, attachments, Unicode, OTP purpose/expiry, promotions, ambiguous codes, concurrent emails, reload and recipient isolation")
