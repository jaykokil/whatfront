import { useEffect, useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "https://back-a9dq.onrender.com/api";

export default function BarcodeScaleConnector() {
  const scannerInputRef = useRef(null);
  const barcodeTimerRef = useRef(null);

  const [scaleStatus, setScaleStatus] = useState("Disconnected");
  const [scannerStatus, setScannerStatus] = useState("Disconnected");
  const [barcode, setBarcode] = useState("");
  const [manualBarcode, setManualBarcode] = useState("");
  const [currentWeight, setCurrentWeight] = useState("");
  const [selectedBottle, setSelectedBottle] = useState(null);
  const [remainingML, setRemainingML] = useState(0);
  const [logs, setLogs] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const [loadingBottle, setLoadingBottle] = useState(false);
  const [error, setError] = useState("");

  const connectDevices = async () => {
    setError("");
    setScannerStatus("Ready - scan barcode now");
    setIsListening(true);

    setTimeout(() => {
      scannerInputRef.current?.focus();
    }, 100);

    await connectScale();
  };

  const connectScale = async () => {
    try {
      if (!("serial" in navigator)) {
        setScaleStatus("Web Serial not supported");
        alert("Use Chrome or Edge. Web Serial is not supported in this browser.");
        return;
      }

      const selectedPort = await navigator.serial.requestPort();

      await selectedPort.open({
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "none",
      });

      setScaleStatus("Connected");
      readWeight(selectedPort);
    } catch (error) {
      console.error(error);
      setScaleStatus("Connection failed");
    }
  };

  const readWeight = async (selectedPort) => {
    try {
      const decoder = new TextDecoderStream();
      selectedPort.readable.pipeTo(decoder.writable);
      const reader = decoder.readable.getReader();

      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += value;
        const match = buffer.match(/-?\d+(\.\d+)?/);

        if (match) {
          const cleanWeight = Math.round(Number(match[0]));
          setCurrentWeight(cleanWeight);
          buffer = "";
        }
      }
    } catch (error) {
      console.error(error);
      setScaleStatus("Reading stopped");
    }
  };

  const fetchBottleFromDatabase = async (scannedBarcode) => {
    setLoadingBottle(true);
    setError("");

    try {
      const response = await fetch(`${API_URL}/bottles/${scannedBarcode}`);

      if (!response.ok) {
        throw new Error("Bottle not found in database");
      }

      const data = await response.json();
      const bottle = data.bottle || data;

      setSelectedBottle({
        _id: bottle._id,
        productId: bottle.productId || "",
        barcode: bottle.barcode || scannedBarcode,
        brandName: bottle.brandName || bottle.brand || "",
        category: bottle.category || "",
        bottleSizeML: Number(bottle.bottleSizeML || bottle.bottleSize || 750),
        emptyBottleWeightG: Number(bottle.emptyBottleWeightG || bottle.emptyWeight || 400),
        costPrice: Number(bottle.costPrice || bottle.cost || 0),
      });

      setScannerStatus("Barcode matched with database");
    } catch (err) {
      console.error(err);
      setSelectedBottle(null);
      setError(`Barcode ${scannedBarcode} not found in database.`);
      setScannerStatus("Bottle not found");
    } finally {
      setLoadingBottle(false);
      setBarcode("");
      setTimeout(() => {
        scannerInputRef.current?.focus();
      }, 100);
    }
  };

  const handleScannerInput = (value) => {
    setBarcode(value);

    if (barcodeTimerRef.current) {
      clearTimeout(barcodeTimerRef.current);
    }

    barcodeTimerRef.current = setTimeout(() => {
      const cleanBarcode = value.trim();
      if (cleanBarcode.length > 0) {
        fetchBottleFromDatabase(cleanBarcode);
      }
    }, 120);
  };

  const handleScannerKeyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const cleanBarcode = barcode.trim();
      if (cleanBarcode.length > 0) {
        fetchBottleFromDatabase(cleanBarcode);
      }
    }
  };

  const processManualBarcode = () => {
    const cleanBarcode = manualBarcode.trim();
    if (!cleanBarcode) return;
    setBarcode(cleanBarcode);
    fetchBottleFromDatabase(cleanBarcode);
    setManualBarcode("");
  };

  useEffect(() => {
    if (!selectedBottle) {
      setRemainingML(0);
      return;
    }

    const weight = Number(currentWeight);
    const emptyBottleWeight = Number(selectedBottle.emptyBottleWeightG);
    const bottleSize = Number(selectedBottle.bottleSizeML);

    if (!weight || weight <= emptyBottleWeight) {
      setRemainingML(0);
      return;
    }

    const liquidML = Math.round(weight - emptyBottleWeight);
    setRemainingML(Math.min(liquidML, bottleSize));
  }, [currentWeight, selectedBottle]);

  const saveReading = async () => {
    if (!selectedBottle) {
      alert("Scan a valid bottle first.");
      return;
    }

    const newLog = {
      time: new Date().toLocaleString(),
      barcode: selectedBottle.barcode,
      productId: selectedBottle.productId,
      brandName: selectedBottle.brandName,
      category: selectedBottle.category,
      bottleSizeML: selectedBottle.bottleSizeML,
      emptyBottleWeightG: selectedBottle.emptyBottleWeightG,
      currentWeightG: Number(currentWeight || 0),
      remainingML,
    };

    setLogs((prev) => [newLog, ...prev]);

    try {
      await fetch(`${API_URL}/readings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(newLog),
      });
    } catch (err) {
      console.warn("Reading saved locally only. Backend readings route not available yet.");
    }

    setSelectedBottle(null);
    setScannerStatus("Ready - scan next barcode");

    setTimeout(() => {
      scannerInputRef.current?.focus();
    }, 100);
  };

  useEffect(() => {
    const keepFocus = () => {
      if (isListening) {
        scannerInputRef.current?.focus();
      }
    };

    window.addEventListener("click", keepFocus);
    return () => window.removeEventListener("click", keepFocus);
  }, [isListening]);

  return (
    <section className="machine-card">
      <div className="top-row">
        <div>
          <h1>Scanner + Database + Weight Flow</h1>
          <p className="muted">
            Scan barcode → fetch bottle from database → read weight → calculate remaining ML.
          </p>
        </div>

        <button className="primary-btn" onClick={connectDevices}>
          Connect Devices
        </button>
      </div>

      <div className="status-grid">
        <div className="status-box">
          <span>Weight Machine</span>
          <strong>{scaleStatus}</strong>
        </div>

        <div className="status-box">
          <span>Barcode Scanner</span>
          <strong>{scannerStatus}</strong>
        </div>

        <div className="status-box">
          <span>Database API</span>
          <strong>{API_URL}</strong>
        </div>
      </div>

      <input
        ref={scannerInputRef}
        className="scanner-capture"
        value={barcode}
        onChange={(e) => handleScannerInput(e.target.value)}
        onKeyDown={handleScannerKeyDown}
        placeholder="Scanner capture input"
        autoComplete="off"
      />

      <div className="manual-row">
        <input
          value={manualBarcode}
          onChange={(e) => setManualBarcode(e.target.value)}
          placeholder="Type barcode manually for testing"
        />
        <button onClick={processManualBarcode}>
          {loadingBottle ? "Searching..." : "Search Barcode"}
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="reading-grid">
        <label>Barcode<input value={selectedBottle?.barcode || ""} readOnly /></label>
        <label>Product ID<input value={selectedBottle?.productId || ""} readOnly /></label>
        <label>Brand Name<input value={selectedBottle?.brandName || ""} readOnly /></label>
        <label>Category<input value={selectedBottle?.category || ""} readOnly /></label>
        <label>Bottle Size ML<input value={selectedBottle?.bottleSizeML || ""} readOnly /></label>
        <label>Empty Bottle Weight G<input value={selectedBottle?.emptyBottleWeightG || ""} readOnly /></label>
        <label>Cost Price<input value={selectedBottle?.costPrice || ""} readOnly /></label>
        <label>Current Weight G<input value={currentWeight} readOnly /></label>
        <label>Remaining ML<input value={remainingML} readOnly /></label>
      </div>

      <button className="save-btn" onClick={saveReading}>
        Save Reading
      </button>

      <div className="history-section">
        <h2>Scanned History</h2>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Barcode</th>
                <th>Product ID</th>
                <th>Brand Name</th>
                <th>Category</th>
                <th>Weight G</th>
                <th>Remaining ML</th>
              </tr>
            </thead>

            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan="7" className="empty">No readings yet.</td>
                </tr>
              ) : (
                logs.map((item, index) => (
                  <tr key={index}>
                    <td>{item.time}</td>
                    <td>{item.barcode}</td>
                    <td>{item.productId}</td>
                    <td>{item.brandName}</td>
                    <td>{item.category}</td>
                    <td>{item.currentWeightG}</td>
                    <td>{item.remainingML}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
