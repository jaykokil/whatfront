import React, { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";

const API = import.meta.env.VITE_API_URL || "https://backend-all-tgww.onrender.com/api";

const OUTLETS = [
  { id: "pune-central", name: "Pune Central" },
  { id: "pune-airport", name: "Pune Airport" },
  { id: "pune-nda", name: "Pune NDA" },
];

const BAR_NAMES = ["Stock Room", "Sky Bar", "Low Bar"];

const LOCAL_CLOSING_KEY = "inventory_local_closing_rows_v2";

function getLocalClosingRows() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_CLOSING_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLocalClosingRow(row) {
  const key = `${row.outletId}__${row.barId}__${row.productId || row.barcode || row.productCode}`;
  const existing = getLocalClosingRows().filter((r) => `${r.outletId}__${r.barId}__${r.productId || r.barcode || r.productCode}` !== key);
  localStorage.setItem(LOCAL_CLOSING_KEY, JSON.stringify([{ ...row, localSavedAt: new Date().toISOString() }, ...existing]));
}

function mergeLocalClosingRows(serverRows) {
  const merged = [...serverRows];
  getLocalClosingRows().forEach((localRow) => {
    const key = `${localRow.outletId}__${localRow.barId}__${localRow.productId || localRow.barcode || localRow.productCode}`;
    const index = merged.findIndex((r) => `${r.outletId}__${r.barId}__${r.productId || r.barcode || r.productCode}` === key);
    if (index >= 0) merged[index] = { ...merged[index], ...localRow };
    else merged.unshift(localRow);
  });
  return merged;
}

const BARS = OUTLETS.flatMap((outlet) =>
  BAR_NAMES.map((name) => ({
    id: `${outlet.id}-${name.toLowerCase().replaceAll(" ", "-")}`,
    outletId: outlet.id,
    outletName: outlet.name,
    name,
    type: name === "Stock Room" ? "stock" : "bar",
  }))
);

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("inventory_user") || "null");
  } catch {
    return null;
  }
}

async function apiRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new Error("Backend not reachable. Check backend URL / VITE_API_URL.");
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || `Server error: ${response.status}`);
  return data;
}

const cap = (s) => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);

function Button({ children, variant = "primary", className = "", ...props }) {
  return <button className={`btn ${variant} ${className}`} {...props}>{children}</button>;
}

function Card({ children, className = "", onClick }) {
  return <div className={`card ${className}`} onClick={onClick}>{children}</div>;
}

function SelectBox({ value, onChange, children, disabled }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>{children}</select>;
}

function StatCard({ title, value, sub, icon, children }) {
  return (
    <Card>
      <div className="stat">
        <div>
          <p className="muted">{title}</p>
          <h2>{value}</h2>
          {sub && <p className="small">{sub}</p>}
          {children}
        </div>
        <div className="statIcon">{icon}</div>
      </div>
    </Card>
  );
}

function MachineStatusCard({ onBarcodeDetected, onWeightDetected, currentWeight, onResetWeight }) {
  const scannerInputRef = useRef(null);
  const barcodeTimerRef = useRef(null);
  const weightSamplesRef = useRef([]);
  const weightLockedRef = useRef(false);

  const [scaleStatus, setScaleStatus] = useState("Disconnected");
  const [scannerStatus, setScannerStatus] = useState("Disconnected");
  const [weightStatus, setWeightStatus] = useState("Waiting");
  const [barcodeValue, setBarcodeValue] = useState("");
  const [liveWeight, setLiveWeight] = useState("");
  const [isListening, setIsListening] = useState(false);

  function resetStableWeight() {
    weightSamplesRef.current = [];
    weightLockedRef.current = false;
    setWeightStatus("Waiting");
    onResetWeight?.();
  }

  async function connectDevices() {
    setScannerStatus("Ready");
    setIsListening(true);
    setTimeout(() => scannerInputRef.current?.focus(), 100);

    try {
      if (!("serial" in navigator)) {
        setScaleStatus("Not Supported");
        alert("Use Chrome or Edge. Web Serial is not supported in this browser.");
        return;
      }

      const selectedPort = await navigator.serial.requestPort();
      await selectedPort.open({
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "none"
      });

      setScaleStatus("Connected");
      resetStableWeight();
      readWeight(selectedPort);
    } catch (error) {
      console.error(error);
      setScaleStatus("Connection Failed");
    }
  }

  function handleIncomingWeight(raw) {
    const cleanWeight = Math.round(Number(raw));
    if (!Number.isFinite(cleanWeight)) return;

    setLiveWeight(cleanWeight);

    if (weightLockedRef.current) return;

    const samples = [...weightSamplesRef.current, cleanWeight].slice(-8);
    weightSamplesRef.current = samples;

    if (samples.length < 8) {
      setWeightStatus("Reading");
      return;
    }

    const min = Math.min(...samples);
    const max = Math.max(...samples);

    if (max - min <= 2) {
      const stable = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
      weightLockedRef.current = true;
      setWeightStatus("Stable Locked");
      onWeightDetected(stable);
    } else {
      setWeightStatus("Stabilizing");
    }
  }

  async function readWeight(selectedPort) {
    try {
      const decoder = new TextDecoderStream();
      selectedPort.readable.pipeTo(decoder.writable);
      const reader = decoder.readable.getReader();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += value;
        const matches = buffer.match(/-?\d+(\.\d+)?/g);

        if (matches && matches.length > 0) {
          handleIncomingWeight(matches[matches.length - 1]);
          if (buffer.length > 80 || /[\r\n]/.test(buffer)) buffer = "";
        }
      }
    } catch (error) {
      console.error(error);
      setScaleStatus("Reading Stopped");
    }
  }

  function processBarcode(code) {
    const cleanCode = String(code || "").trim();
    if (!cleanCode) return;

    setScannerStatus("Scanned");
    resetStableWeight();
    onBarcodeDetected(cleanCode);
    setBarcodeValue("");
    setTimeout(() => scannerInputRef.current?.focus(), 100);
  }

  function handleScannerInput(value) {
    setBarcodeValue(value);
    if (barcodeTimerRef.current) clearTimeout(barcodeTimerRef.current);
    barcodeTimerRef.current = setTimeout(() => processBarcode(value), 120);
  }

  function handleScannerKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      processBarcode(barcodeValue);
    }
  }

  useEffect(() => {
    function keepScannerFocused() {
      if (isListening) scannerInputRef.current?.focus();
    }
    window.addEventListener("click", keepScannerFocused);
    return () => window.removeEventListener("click", keepScannerFocused);
  }, [isListening]);

  return (
    <StatCard title="Device Status" value={scaleStatus} sub={`scanner: ${scannerStatus}`} icon="📡">
      <Button className="deviceBtn" onClick={connectDevices}>Connect Device</Button>
      <p className="small" style={{ marginTop: 8 }}>Live Weight: {liveWeight ? `${liveWeight} G` : "--"}</p>
      <p className="small">Stable Weight: {currentWeight ? `${currentWeight} G` : "--"} • {weightStatus}</p>
      <Button variant="secondary" style={{ marginTop: 8 }} onClick={resetStableWeight}>Read Again</Button>
      <input
        ref={scannerInputRef}
        value={barcodeValue}
        onChange={(e) => handleScannerInput(e.target.value)}
        onKeyDown={handleScannerKeyDown}
        autoComplete="off"
        aria-label="Barcode scanner capture"
        style={{ position: "absolute", opacity: 0, width: 1, height: 1, pointerEvents: "none" }}
      />
    </StatCard>
  );
}

function ProductSearch({ products, value, onChange, onPick }) {
  const results = useMemo(() => {
    const q = value.toLowerCase().trim();
    if (!q) return [];
    return products.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.productCode.toLowerCase().includes(q) ||
      String(p.barcode || "").toLowerCase().includes(q)
    ).slice(0, 5);
  }, [products, value]);

  return (
    <div className="searchBox">
      <input placeholder="Search brand name manually" value={value} onChange={(e) => onChange(e.target.value)} />
      {results.length > 0 && (
        <div className="suggestions">
          {results.map((p) => (
            <button key={p.id} onClick={() => onPick(p)}>
              <b>{p.name}</b><span>{p.category} • {p.bottleSizeMl} ML • {p.barcode}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function InventoryReading({ disabled, row, products, brandSearch, setBrandSearch, onPickProduct, closingFullBottle, setClosingFullBottle, closingEmptyBottle, setClosingEmptyBottle, closingOpenBottleMl, setClosingOpenBottleMl, onSave }) {
  const active = !!row;
  return (
    <div className={`reading ${disabled ? "disabled" : ""}`}>
      <div className="readingTop">
        <div className="brandBlock">
          <p className="muted">Brand Name</p>
          <ProductSearch products={products} value={brandSearch} onChange={setBrandSearch} onPick={onPickProduct} />
          <p className="muted">{active ? `${row.category} • ${row.bottleSize} ML` : "Select or scan a product"}</p>
        </div>
        <div className="readingRight">
          <div className="currentReading">
            <p className="muted">Current Reading</p>
            <p className="small">REMAINING</p>
            <h2>{active ? `${row.closingOpenBottleRemainingMl || 0} ML` : "--/--"}</h2>
          </div>
        </div>
      </div>

      <div className="readingGrid">
        <div className="mini"><p>OPENING FULL BOTTLES</p><h2>{active ? row.openingFullBottleCount : "-"}</h2></div>
        <div className="mini"><p>OPENING OPEN BOTTLE ML</p><h2>{active ? row.openingOpenBottleRemainingMl : "-"}</h2></div>
        <div className="mini"><p>CLOSING FULL BOTTLES</p><input value={closingFullBottle} onChange={(e) => setClosingFullBottle(e.target.value)} placeholder="Type full bottles" /></div>
        <div className="mini"><p>CLOSING EMPTY BOTTLES</p><input value={closingEmptyBottle} onChange={(e) => setClosingEmptyBottle(e.target.value)} placeholder="Type empty bottles" /></div>
        <div className="mini wide"><p>CLOSING OPEN BOTTLE ML</p><input value={closingOpenBottleMl} onChange={(e) => setClosingOpenBottleMl(e.target.value)} placeholder="Type open bottle ML" /></div>
      </div>

      <div className="rowButtons">
        <Button onClick={onSave}>Save Closing</Button>
        <Button variant="secondary">Read Next Bottle</Button>
        <Button variant="secondary">Update Indent</Button>
      </div>
    </div>
  );
}

function InventoryTable({ rows }) {
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            <th>Product ID</th><th>Brand Name</th><th>Category</th><th>Bottle Size</th><th>Cost</th>
            <th>Total Full Bottle</th><th>Total Open Bottle</th><th>Stock Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan="8" className="emptyCell">No inventory history yet.</td></tr> : rows.map((r) => {
            const full = r.totalFullBottle ?? r.closingFullBottleCount ?? r.openingFullBottleCount ?? 0;
            const open = r.totalOpenBottle ?? r.closingOpenBottleRemainingMl ?? r.openingOpenBottleRemainingMl ?? 0;
            return (
              <tr key={r.id}>
                <td>{r.productCode}</td>
                <td>{r.name}</td>
                <td>{r.category}</td>
                <td>{r.bottleSize}</td>
                <td>{r.costOfBottle}</td>
                <td>{full}</td>
                <td>{open}</td>
                <td>{Number(r.stockValue ?? (Number(full || 0) * Number(r.costOfBottle || 0))).toLocaleString("en-IN")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Login({ onLogin }) {
  const [username, setUsername] = useState("skyline");
  const [password, setPassword] = useState("1234");
  const [message, setMessage] = useState("Use any username/password");

  async function submit(e) {
    e.preventDefault();
    const result = await onLogin(username.trim(), password.trim());
    if (!result.ok) setMessage(result.message || "Login failed");
  }

  return (
    <div className="loginPage">
      <div className="hero">
        <span className="pill">Inventory Platform</span>
        <h1>Outlet-first hospitality inventory system</h1>
        <p>Outlet, bar, stock room, transfer and closing inventory.</p>
      </div>
      <Card className="loginCard">
        <h2>Login</h2>
        <p className="muted">Login</p>
        <form onSubmit={submit}>
          <div className="field"><label>Username</label><input value={username} onChange={(e) => setUsername(e.target.value)} /></div>
          <div className="field"><label>Password</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <Button type="submit">Continue</Button>
        </form>
        <div className="note">{message}</div>
      </Card>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(() => {
    const user = getStoredUser();
    return user ? { type: "user", userId: user.id || "local-user" } : null;
  });

  async function login(username, password) {
    const user = { id: "local-user", username, name: username || "User", businessName: username || "Inventory User" };
    localStorage.setItem("inventory_user", JSON.stringify(user));
    setSession({ type: "user", userId: user.id });
    return { ok: true };
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("inventory_user");
    setSession(null);
  }

  if (!session) return <Login onLogin={login} />;
  return <Dashboard onLogout={logout} />;
}

function Dashboard({ onLogout }) {
  const [page, setPage] = useState("dashboard");
  const [outlets] = useState(OUTLETS);
  const [bars] = useState(BARS);
  const [products, setProducts] = useState([]);
  const [selectedOutletId, setSelectedOutletId] = useState("");
  const [selectedBarId, setSelectedBarId] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [brandSearch, setBrandSearch] = useState("");
  const [closingFullBottle, setClosingFullBottle] = useState("");
  const [closingEmptyBottle, setClosingEmptyBottle] = useState("");
  const [closingOpenBottleMl, setClosingOpenBottleMl] = useState("");
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("");
  const [history, setHistory] = useState([]);
  const [movements, setMovements] = useState([]);
  const [drillOutletId, setDrillOutletId] = useState("");
  const [drillBarId, setDrillBarId] = useState("");
  const [currentWeight, setCurrentWeight] = useState("");
  const [lastBarcode, setLastBarcode] = useState("");
  const [modal, setModal] = useState(null);
  const [moveForm, setMoveForm] = useState({ barcode: "", quantityFull: "0", quantityOpen: "0", openBottleML: "0", toOutlet: "", toLocation: "", note: "" });

  const storedUser = getStoredUser();
  const currentUserName = storedUser?.businessName || storedUser?.name || "Inventory User";
  const currentOwnerName = storedUser?.ownerName || storedUser?.username || "";

  const selectedOutlet = outlets.find((o) => o.id === selectedOutletId);
  const selectedBar = bars.find((b) => b.id === selectedBarId);
  const isStockRoom = String(selectedBar?.type || "").includes("stock");
  const activeRows = rows.filter((r) => r.outletId === selectedOutletId && r.barId === selectedBarId);
  const latestRow = activeRows.find((r) => r.productId === selectedProductId) || activeRows[0];

  function mapBottle(b) {
    return {
      id: b._id,
      productCode: b.productId || "",
      barcode: b.barcode || "",
      name: b.brandName || "",
      category: b.category || "",
      bottleSizeMl: Number(b.bottleSizeML || 750),
      costOfBottle: Number(b.costPrice || 0),
      emptyBottleWeightG: Number(b.emptyBottleWeightG || 400),
    };
  }

  function mapStock(s) {
    const outlet = outlets.find((o) => o.name === s.outlet);
    const bar = bars.find((b) => b.outletId === outlet?.id && b.name === s.location);
    return {
      id: s._id,
      outletId: outlet?.id || "",
      barId: bar?.id || "",
      productId: s.bottle || s.barcode,
      productCode: s.productId || "",
      barcode: s.barcode || "",
      name: s.brandName || "",
      category: s.category || "",
      bottleSize: Number(s.bottleSizeML || 750),
      bottleSizeMl: Number(s.bottleSizeML || 750),
      costOfBottle: Number(s.costPrice || 0),
      openingFullBottleCount: Number(s.fullBottles || 0),
      openingOpenBottleRemainingMl: Number(s.openBottleML || 0),
      closingFullBottleCount: Number(s.fullBottles || 0),
      closingOpenBottleRemainingMl: Number(s.openBottleML || 0),
      totalFullBottle: Number(s.fullBottles || 0),
      totalOpenBottle: Number(s.openBottles || 0),
      stockValue: Number(s.stockValue || 0),
    };
  }

  async function loadAll() {
    try {
      const [bottleData, stockData, readingData, movementData] = await Promise.all([
        apiRequest("/bottles"),
        apiRequest("/stock"),
        apiRequest("/readings"),
        apiRequest("/stock/movements/history"),
      ]);
      setProducts((Array.isArray(bottleData) ? bottleData : []).map(mapBottle));
      setRows(mergeLocalClosingRows((Array.isArray(stockData) ? stockData : []).map(mapStock)));
      setHistory(Array.isArray(readingData) ? readingData : []);
      setMovements(Array.isArray(movementData) ? movementData : []);
      setStatus("");
    } catch (e) {
      setStatus(e.message);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleBarcodeDetected(code) {
    setLastBarcode(code);
    try {
      const bottle = await apiRequest(`/bottles/${code}`);
      const product = mapBottle(bottle);
      setProducts((prev) => prev.some((p) => p.barcode === product.barcode) ? prev : [product, ...prev]);
      setSelectedProductId(product.id);
      setBrandSearch(product.name);
      setStatus(`Barcode scanned: ${code}. ${product.name} found.`);
    } catch {
      setStatus(`Barcode scanned: ${code}. Product not found in database.`);
      setBrandSearch(code);
    }
  }

  function handleWeightDetected(weight) {
    setCurrentWeight(weight);
    const product = products.find((p) => p.id === selectedProductId || p.barcode === lastBarcode);
    if (!product) return;

    const remaining = Math.max(0, Math.min(product.bottleSizeMl, Math.round(Number(weight) - Number(product.emptyBottleWeightG || 0))));
    setClosingOpenBottleMl(String(remaining));
  }

  function onPickProduct(product) {
    setSelectedProductId(product.id);
    setBrandSearch(product.name);
    setClosingOpenBottleMl("");
  }

  async function saveManualEntry() {
    if (!selectedOutlet || !selectedBar) {
      setStatus("Please select outlet and bar / stock room first.");
      return;
    }

    const product = products.find((p) => p.id === selectedProductId) || products.find((p) => p.name === brandSearch);
    if (!product) {
      setStatus("Please select a product first.");
      return;
    }

    const existingRow = rows.find((r) =>
      r.outletId === selectedOutlet.id &&
      r.barId === selectedBar.id &&
      (r.productId === product.id || r.barcode === product.barcode || r.productCode === product.productCode)
    );

    const closingRow = {
      id: `${selectedOutlet.id}-${selectedBar.id}-${product.id || product.barcode}`,
      outletId: selectedOutlet.id,
      barId: selectedBar.id,
      productId: product.id || product.barcode,
      productCode: product.productCode || "",
      barcode: product.barcode || "",
      name: product.name || brandSearch,
      category: product.category || "",
      bottleSize: Number(product.bottleSizeMl || 750),
      bottleSizeMl: Number(product.bottleSizeMl || 750),
      costOfBottle: Number(product.costOfBottle || 0),
      openingFullBottleCount: Number(existingRow?.openingFullBottleCount || existingRow?.totalFullBottle || 0),
      openingOpenBottleRemainingMl: Number(existingRow?.openingOpenBottleRemainingMl || existingRow?.totalOpenBottle || 0),
      closingFullBottleCount: Number(closingFullBottle || 0),
      closingOpenBottleRemainingMl: Number(closingOpenBottleMl || 0),
      closingEmptyBottleCount: Number(closingEmptyBottle || 0),
      totalFullBottle: Number(closingFullBottle || 0),
      totalOpenBottle: Number(closingOpenBottleMl || 0),
      stockValue: Number(closingFullBottle || 0) * Number(product.costOfBottle || 0),
    };

    try {
      await apiRequest("/readings", {
        method: "POST",
        body: JSON.stringify({
          time: new Date().toLocaleString(),
          barcode: product.barcode,
          productId: product.productCode,
          brandName: product.name,
          category: product.category,
          bottleSizeML: product.bottleSizeMl,
          emptyBottleWeightG: product.emptyBottleWeightG,
          currentWeightG: Number(currentWeight || 0),
          remainingML: Number(closingOpenBottleMl || 0),
          closingFullBottle: Number(closingFullBottle || 0),
          closingEmptyBottle: Number(closingEmptyBottle || 0),
          outlet: selectedOutlet.name,
          location: selectedBar.name,
        }),
      });

      saveLocalClosingRow(closingRow);
      setRows((prev) => mergeLocalClosingRows(prev));
      setStatus("Closing entry saved and inventory updated.");
      setClosingFullBottle("");
      setClosingEmptyBottle("");
      setClosingOpenBottleMl("");
      await loadAll();
    } catch (e) {
      saveLocalClosingRow(closingRow);
      setRows((prev) => mergeLocalClosingRows(prev));
      setStatus(`Saved locally. Backend reading save failed: ${e.message}`);
    }
  }

  function openOutlet(outletId) {
    setDrillOutletId(outletId);
    setPage("outletDetail");
  }

  function openBar(outletId, barId) {
    setSelectedOutletId(outletId);
    setSelectedBarId(barId);
    setDrillOutletId(outletId);
    setDrillBarId(barId);
    setPage("locationStock");
  }

  function startMove(type) {
    setModal(type);
    setMoveForm({
      barcode: latestRow?.barcode || "",
      quantityFull: "0",
      quantityOpen: "0",
      openBottleML: "0",
      toOutlet: selectedOutlet?.name || OUTLETS[0].name,
      toLocation: "Stock Room",
      note: "",
    });
  }

  async function submitMove(e) {
    e.preventDefault();
    if (!selectedOutlet || !selectedBar) {
      setStatus("Select outlet and bar / stock room first.");
      return;
    }

    try {
      const barcode = moveForm.barcode.trim();
      if (!barcode) throw new Error("Barcode is required.");

      if (modal === "assign") {
        await apiRequest("/stock/assign", {
          method: "POST",
          body: JSON.stringify({
            barcode,
            toOutlet: selectedOutlet.name,
            toLocation: selectedBar.name,
            quantityFull: Number(moveForm.quantityFull || 0),
            quantityOpen: Number(moveForm.quantityOpen || 0),
            openBottleML: Number(moveForm.openBottleML || 0),
            note: moveForm.note,
          }),
        });
        setStatus("Stock assigned successfully.");
      } else {
        await apiRequest("/stock/transfer", {
          method: "POST",
          body: JSON.stringify({
            barcode,
            fromOutlet: selectedOutlet.name,
            fromLocation: selectedBar.name,
            toOutlet: moveForm.toOutlet,
            toLocation: moveForm.toLocation,
            quantityFull: Number(moveForm.quantityFull || 0),
            quantityOpen: Number(moveForm.quantityOpen || 0),
            openBottleML: Number(moveForm.openBottleML || 0),
            note: moveForm.note,
          }),
        });
        setStatus("Stock transferred successfully.");
      }

      setModal(null);
      await loadAll();
    } catch (e) {
      setStatus(e.message);
    }
  }

  function exportCsv() {
    const header = ["Product ID", "Brand Name", "Category", "Bottle Size", "Cost", "Total Full Bottle", "Total Open Bottle", "Stock Value"];
    const body = activeRows.map((r) => [r.productCode, r.name, r.category, r.bottleSize, r.costOfBottle, r.totalFullBottle, r.totalOpenBottle, r.stockValue]);
    const csv = [header, ...body].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${selectedOutlet?.name || "inventory"}_${selectedBar?.name || "stock"}.csv`;
    link.click();
  }

  const outletBars = (outletId) => bars.filter((b) => b.outletId === outletId);
  const drillOutlet = outlets.find((o) => o.id === drillOutletId);

  return (
    <div className="app">
      <header>
        <div>
          <p className="muted">User Interface</p>
          <h1>{currentUserName}</h1>
          <p className="muted">{currentOwnerName}</p>
        </div>
        <nav>
          {["dashboard", "outlet", "report", "history"].map((item) => (
            <Button key={item} variant={page === item ? "primary" : "secondary"} onClick={() => setPage(item)}>
              {cap(item)}
            </Button>
          ))}
          <Button variant="secondary" onClick={loadAll}>Refresh</Button>
          <Button variant="secondary" onClick={onLogout}>Logout</Button>
        </nav>
      </header>

      <main>
        {status && <div className="alert">{status}</div>}

        {page === "dashboard" && (
          <>
            <section className="stats">
              <StatCard title="Restaurant / Bar" value={currentUserName} sub={currentOwnerName || "Active outlet"} icon="🏢" />
              <MachineStatusCard
                currentWeight={currentWeight}
                onBarcodeDetected={handleBarcodeDetected}
                onWeightDetected={handleWeightDetected}
                onResetWeight={() => {
                  setCurrentWeight("");
                  setClosingOpenBottleMl("");
                }}
              />
            </section>

            <Card>
              <div className="cardHead inventoryHead">
                <div>
                  <h2>Inventory</h2>
                  <p className="muted">Select outlet and stock room/bar to take inventory, assign, transfer or scan bottle.</p>
                </div>

                <div className="compactFilters">
                  <SelectBox value={selectedOutletId} onChange={(value) => { setSelectedOutletId(value); setSelectedBarId(""); }}>
                    <option value="">Select outlet</option>
                    {outlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}
                  </SelectBox>

                  <SelectBox value={selectedBarId} onChange={setSelectedBarId} disabled={!selectedOutletId}>
                    <option value="">Select bar or stock room</option>
                    {outletBars(selectedOutletId).map((bar) => <option key={bar.id} value={bar.id}>{bar.name}</option>)}
                  </SelectBox>
                </div>
              </div>

              <InventoryReading
                disabled={!selectedOutletId || !selectedBarId}
                row={latestRow}
                products={products}
                brandSearch={brandSearch}
                setBrandSearch={setBrandSearch}
                onPickProduct={onPickProduct}
                closingFullBottle={closingFullBottle}
                setClosingFullBottle={setClosingFullBottle}
                closingEmptyBottle={closingEmptyBottle}
                setClosingEmptyBottle={setClosingEmptyBottle}
                closingOpenBottleMl={closingOpenBottleMl}
                setClosingOpenBottleMl={setClosingOpenBottleMl}
                onSave={saveManualEntry}
              />
            </Card>
          </>
        )}

        {page === "outlet" && (
          <div>
            <h2>Outlets</h2>
            <p className="muted">Click an outlet card to view stock room and bars.</p>
            <div className="outletGrid">
              {outlets.map((outlet) => (
                <Card key={outlet.id}>
                  <button className="outletCardButton" onClick={() => openOutlet(outlet.id)}>
                    <h3>{outlet.name}</h3>
                    <p className="muted">Stock Room • Sky Bar • Low Bar</p>
                  </button>
                </Card>
              ))}
            </div>
          </div>
        )}

        {page === "outletDetail" && (
          <Card>
            <div className="cardHead">
              <div>
                <h2>{drillOutlet?.name || "Outlet"}</h2>
                <p className="muted">Select Stock Room / Bar to view stock.</p>
              </div>
              <Button variant="secondary" onClick={() => setPage("outlet")}>Back</Button>
            </div>
            <div className="outletGrid">
              {outletBars(drillOutletId).map((bar) => (
                <Card key={bar.id}>
                  <button className="outletCardButton" onClick={() => openBar(drillOutletId, bar.id)}>
                    <h3>{bar.name}</h3>
                    <p className="muted">View stock in {bar.name}</p>
                  </button>
                </Card>
              ))}
            </div>
          </Card>
        )}

        {page === "locationStock" && (
          <Card>
            <div className="cardHead">
              <div>
                <h2>Stock in the {selectedBar?.name || "Bar"}</h2>
                <p className="muted">{selectedOutlet?.name} / {selectedBar?.name}</p>
              </div>
              <div className="rowButtons">
                <Button disabled={!selectedOutlet || !selectedBar} onClick={() => startMove("assign")}>Assign</Button>
                <Button disabled={!selectedOutlet || !selectedBar} onClick={() => startMove("transfer")}>Transfer</Button>
                <Button variant="secondary" onClick={exportCsv}>Export</Button>
              </div>
            </div>
            <InventoryTable rows={activeRows} isStockRoom={isStockRoom} />
          </Card>
        )}

        {page === "report" && (
          <Card>
            <h2>Report</h2>
            <p className="muted">Export stock data for selected outlet and bar/stock room.</p>
            <div className="filters">
              <SelectBox value={selectedOutletId} onChange={(value) => { setSelectedOutletId(value); setSelectedBarId(""); }}>
                <option value="">Select outlet</option>
                {outlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}
              </SelectBox>
              <SelectBox value={selectedBarId} onChange={setSelectedBarId} disabled={!selectedOutletId}>
                <option value="">Select bar or stock room</option>
                {outletBars(selectedOutletId).map((bar) => <option key={bar.id} value={bar.id}>{bar.name}</option>)}
              </SelectBox>
              <Button onClick={exportCsv}>Export Inventory</Button>
            </div>
          </Card>
        )}

        {page === "history" && (
          <Card>
            <div className="cardHead">
              <div>
                <h2>History</h2>
                <p className="muted">Scanned items and stock movement history.</p>
              </div>
              <Button onClick={loadAll}>Load History</Button>
            </div>

            <h3>Scanned Items</h3>
            <div className="history">
              {history.length === 0 && <div className="historyItem"><b>No scanned history yet.</b></div>}
              {history.map((item) => (
                <div className="historyItem" key={item._id}>
                  <b>{item.brandName || item.barcode}</b>
                  <span>{item.outlet} / {item.location} • Remaining: {item.remainingML} ML • Weight: {item.currentWeightG} G</span>
                  <small>{item.time || new Date(item.createdAt).toLocaleString()}</small>
                </div>
              ))}
            </div>

            <h3>Assign / Transfer History</h3>
            <div className="history">
              {movements.length === 0 && <div className="historyItem"><b>No stock movement history yet.</b></div>}
              {movements.map((item) => (
                <div className="historyItem" key={item._id}>
                  <b>{item.type} • {item.brandName || item.barcode}</b>
                  <span>{item.fromLocation ? `${item.fromOutlet} / ${item.fromLocation} → ` : ""}{item.toOutlet} / {item.toLocation}</span>
                  <small>Full: {item.quantityFull} • Open: {item.quantityOpen} • ML: {item.openBottleML} • {new Date(item.createdAt).toLocaleString()}</small>
                </div>
              ))}
            </div>
          </Card>
        )}

        {modal && (
          <div className="modalBg">
            <Card className="modalCard">
              <div className="cardHead">
                <div>
                  <h2>{modal === "assign" ? "Assign Stock" : "Transfer Stock"}</h2>
                  <p className="muted">{selectedOutlet?.name} / {selectedBar?.name}</p>
                </div>
                <Button variant="secondary" onClick={() => setModal(null)}>Close</Button>
              </div>

              <form className="modalGrid" onSubmit={submitMove}>
                <div className="field">
                  <label>Barcode</label>
                  <input
                    value={moveForm.barcode}
                    onChange={(e) => setMoveForm({ ...moveForm, barcode: e.target.value })}
                    placeholder="Scan/type barcode"
                    list="barcode-list"
                    required
                  />
                  <datalist id="barcode-list">
                    {products.map((p) => <option key={p.id} value={p.barcode}>{p.name}</option>)}
                  </datalist>
                </div>

                {modal === "transfer" && (
                  <>
                    <div className="field">
                      <label>To Outlet</label>
                      <select value={moveForm.toOutlet} onChange={(e) => setMoveForm({ ...moveForm, toOutlet: e.target.value })}>
                        {outlets.map((o) => <option key={o.id}>{o.name}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label>To Bar / Stock Room</label>
                      <select value={moveForm.toLocation} onChange={(e) => setMoveForm({ ...moveForm, toLocation: e.target.value })}>
                        {BAR_NAMES.map((name) => <option key={name}>{name}</option>)}
                      </select>
                    </div>
                  </>
                )}

                <div className="field">
                  <label>Full Bottle Count</label>
                  <input type="number" min="0" value={moveForm.quantityFull} onChange={(e) => setMoveForm({ ...moveForm, quantityFull: e.target.value })} />
                </div>
                <div className="field">
                  <label>Open Bottle Count</label>
                  <input type="number" min="0" value={moveForm.quantityOpen} onChange={(e) => setMoveForm({ ...moveForm, quantityOpen: e.target.value })} />
                </div>
                <div className="field">
                  <label>Open Bottle ML</label>
                  <input type="number" min="0" value={moveForm.openBottleML} onChange={(e) => setMoveForm({ ...moveForm, openBottleML: e.target.value })} />
                </div>
                <div className="field wideField">
                  <label>Note</label>
                  <input value={moveForm.note} onChange={(e) => setMoveForm({ ...moveForm, note: e.target.value })} placeholder="Optional note" />
                </div>

                <Button type="submit">{modal === "assign" ? "Assign Stock" : "Transfer Stock"}</Button>
              </form>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
