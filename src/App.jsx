import { useState, useEffect } from "react";
import "./styles.css";

const API_URL = import.meta.env.VITE_API_URL;

export default function App() {
  const [remainingML, setRemainingML] = useState(null);
  const [isReading, setIsReading] = useState(false);
  const [recentInventory, setRecentInventory] = useState([]);

  const selectedBottle = {
    id: 1,
    name: "Bottle",
    fullWeight: 1000,
    emptyWeight: 200,
    capacityML: 750,
  };

  const calculateRemainingML = (weight, bottle) => {
    const liquidWeight = weight - bottle.emptyWeight;
    const totalLiquidWeight = bottle.fullWeight - bottle.emptyWeight;

    if (totalLiquidWeight <= 0) return 0;

    return Math.max(
      0,
      Math.min(
        bottle.capacityML,
        Math.round((liquidWeight / totalLiquidWeight) * bottle.capacityML)
      )
    );
  };

  const readWeightFast = async () => {
    try {
      setIsReading(true);

      const r1 = await fetch(`${API_URL}/weight`);
      const d1 = await r1.json();

      await new Promise((resolve) => setTimeout(resolve, 200));

      const r2 = await fetch(`${API_URL}/weight`);
      const d2 = await r2.json();

      const w1 = Number(d1.weight || 0);
      const w2 = Number(d2.weight || 0);

      const finalWeight = Math.round((w1 + w2) / 2);
      const ml = calculateRemainingML(finalWeight, selectedBottle);

      setRemainingML(ml);

      const recent = {
        id: Date.now(),
        bottleName: selectedBottle.name,
        remainingML: ml,
        time: new Date().toLocaleTimeString(),
      };

      setRecentInventory((prev) => [recent, ...prev.slice(0, 9)]);

    } catch (error) {
      console.error(error);
      alert("Weight read failed");
    } finally {
      setIsReading(false);
    }
  };

  useEffect(() => {
    readWeightFast();
  }, []);

  return (
    <div className="container">
      <h1>Inventory</h1>

      <div className="remaining-ml-box">
        <div>
          <p className="small-label">Remaining ML</p>
          <h2>{remainingML !== null ? `${remainingML} ml` : "-- ml"}</h2>
        </div>

        <button
          className="read-again-btn"
          onClick={readWeightFast}
          disabled={isReading}
        >
          {isReading ? "Reading..." : "Read Again"}
        </button>
      </div>

      <div className="recent-inventory">
        <h3>Recent Inventory</h3>

        {recentInventory.length === 0 ? (
          <p className="empty-text">No recent inventory taken</p>
        ) : (
          recentInventory.map((item) => (
            <div className="recent-inventory-card" key={item.id}>
              <div>
                <strong>{item.bottleName}</strong>
                <p>{item.time}</p>
              </div>
              <span>{item.remainingML} ml</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
