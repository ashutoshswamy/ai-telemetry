from flask import Flask, jsonify
from flask_cors import CORS
from track_antigravity import get_all_metrics, get_user_info

app = Flask(__name__)
CORS(app, origins=["http://localhost:5173"])

@app.route("/")
def index():
    return jsonify({"message": "Antigravity API is running. Please access the React frontend on port 5173."})

@app.route("/api/metrics")
def get_metrics():
    try:
        metrics = get_all_metrics()
        return jsonify({"status": "success", "data": metrics})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/api/user")
def get_user():
    try:
        user_info = get_user_info()
        return jsonify({"status": "success", "data": user_info})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == "__main__":
    # Secure server: debug mode disabled and strictly bound to localhost
    app.run(host="127.0.0.1", port=5000, debug=False)
