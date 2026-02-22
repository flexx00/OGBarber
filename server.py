from flask import Flask, request, jsonify
import requests, json, os
from datetime import datetime

app = Flask(__name__)

WEBHOOK = "PASTE_YOUR_WEBHOOK_URL_HERE"
ROLE_ID = "PASTE_ROLE_ID"   # optional

BOOKINGS_FILE = "bookings.json"

def load_bookings():
    if os.path.exists(BOOKINGS_FILE):
        with open(BOOKINGS_FILE,"r") as f:
            return json.load(f)
    return []

def save_bookings(data):
    with open(BOOKINGS_FILE,"w") as f:
        json.dump(data,f,indent=4)

@app.route("/book", methods=["POST"])
def book():

    data = request.json
    bookings = load_bookings()

    # block taken slots
    for b in bookings:
        if b["date"] == data["date"] and b["time"] == data["time"]:
            return jsonify({"error":"Slot already booked"}), 400

    bookings.append(data)
    save_bookings(bookings)

    embed = {
        "title": "🪒 New Booking - The OG Barber",
        "thumbnail": {"url": "https://yourlogo.com/logo.png"},
        "color": 16753920,
        "fields": [
            {"name":"👤 Name","value":data["name"],"inline":True},
            {"name":"📅 Date","value":data["date"],"inline":True},
            {"name":"⏰ Time","value":data["time"],"inline":True},
            {"name":"💈 Services","value":", ".join(data["services"])},
            {"name":"💰 Total","value":f'£{data["total"]}'}
        ],
        "timestamp": datetime.utcnow().isoformat()
    }

    payload = {
        "content": f"<@&{ROLE_ID}> New booking!",
        "embeds":[embed]
    }

    requests.post(WEBHOOK,json=payload)

    return jsonify({"success":True})

app.run(port=5000)