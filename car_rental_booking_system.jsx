import { useState, useEffect, useRef } from "react";

// ============================================================
// MOCK DATABASE & FLEET INVENTORY
// ============================================================

const VEHICLE_TYPES = {
  economy: { label: "Economy", baseRate: 35, icon: "🚗", examples: ["Toyota Yaris", "Honda Fit"] },
  compact: { label: "Compact", baseRate: 45, icon: "🚙", examples: ["Toyota Corolla", "VW Golf"] },
  midsize: { label: "Midsize", baseRate: 60, icon: "🚘", examples: ["Toyota Camry", "Honda Accord"] },
  suv: { label: "SUV", baseRate: 85, icon: "🚐", examples: ["Toyota RAV4", "Ford Explorer"] },
  luxury: { label: "Luxury", baseRate: 120, icon: "🏎️", examples: ["BMW 5 Series", "Mercedes E-Class"] },
  minivan: { label: "Minivan", baseRate: 75, icon: "🚌", examples: ["Chrysler Pacifica", "Honda Odyssey"] },
};

const LOCATIONS = [
  "Downtown Airport Terminal",
  "City Center Branch",
  "North District Hub",
  "South Station",
  "Harbor View",
  "Business Park",
  "University Avenue",
];

const EXTRAS = {
  gps: { label: "GPS Navigation", rate: 8, icon: "🗺️" },
  child_seat: { label: "Child Seat", rate: 10, icon: "👶" },
  basic_insurance: { label: "Basic Insurance", rate: 12, icon: "🛡️" },
  premium_insurance: { label: "Premium Insurance", rate: 25, icon: "🛡️" },
  roadside: { label: "Roadside Assistance", rate: 6, icon: "🔧" },
  wifi: { label: "Mobile WiFi Hotspot", rate: 9, icon: "📶" },
  additional_driver: { label: "Additional Driver", rate: 15, icon: "👤" },
};

// Generate a mock booking from any booking ID + email (no pre-saved data)
function generateMockBooking(bookingId, email) {
  // Deterministically generate booking details from the ID
  const hash = bookingId.split("").reduce((a, c) => a + c.charCodeAt(0), 0);

  const vehicleKeys = Object.keys(VEHICLE_TYPES);
  const vehicleKey = vehicleKeys[hash % vehicleKeys.length];

  const pickupIdx = hash % LOCATIONS.length;
  const dropoffIdx = (hash + 2) % LOCATIONS.length;

  const now = new Date();
  const daysOffset = (hash % 5) - 1; // -1 to +3 days from now
  const pickup = new Date(now);
  pickup.setDate(now.getDate() + daysOffset + 2);
  pickup.setHours(9 + (hash % 8), 0, 0, 0);

  const dropoff = new Date(pickup);
  dropoff.setDate(pickup.getDate() + 2 + (hash % 4));
  dropoff.setHours(17, 0, 0, 0);

  const extraKeys = Object.keys(EXTRAS);
  const selectedExtras = extraKeys.filter((_, i) => (hash >> i) & 1).slice(0, 2);

  const customerName = email.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  let status = "confirmed";
  if (daysOffset < -1) status = "completed";
  else if (daysOffset === -1) status = "active";

  // Edge cases: some IDs trigger special statuses
  if (bookingId.toUpperCase().startsWith("CXL")) status = "cancelled";
  if (bookingId.toUpperCase().startsWith("ACT")) status = "active";
  if (bookingId.toUpperCase().startsWith("CMP")) status = "completed";

  const days = Math.ceil((dropoff - pickup) / (1000 * 60 * 60 * 24));
  const baseRate = VEHICLE_TYPES[vehicleKey].baseRate;
  const extrasTotal = selectedExtras.reduce((s, k) => s + EXTRAS[k].rate, 0);
  const totalPrice = days * baseRate + extrasTotal * days;

  return {
    id: bookingId.toUpperCase(),
    email: email.toLowerCase(),
    status,
    customerName,
    phone: `+1 (555) ${String(hash).padStart(7, "0").slice(0, 3)}-${String(hash * 7).padStart(7, "0").slice(0, 4)}`,
    vehicleType: vehicleKey,
    vehicleModel: VEHICLE_TYPES[vehicleKey].examples[hash % 2],
    pickupDate: pickup.toISOString().split("T")[0],
    pickupTime: `${String(pickup.getHours()).padStart(2, "0")}:00`,
    dropoffDate: dropoff.toISOString().split("T")[0],
    dropoffTime: "17:00",
    pickupLocation: LOCATIONS[pickupIdx],
    dropoffLocation: LOCATIONS[dropoffIdx],
    extras: selectedExtras,
    baseRate,
    totalDays: days,
    totalPrice,
    isVIP: hash % 7 === 0,
    paymentStatus: "paid",
    plateNumber: `${String.fromCharCode(65 + (hash % 26))}${String.fromCharCode(65 + ((hash * 3) % 26))}-${String(hash * 13 + 1000).slice(-4)}`,
  };
}

// ============================================================
// BUSINESS LOGIC — MODIFICATION RULES
// ============================================================

function checkModificationEligibility(booking) {
  const now = new Date();
  const pickup = new Date(`${booking.pickupDate}T${booking.pickupTime}`);
  const hoursUntilPickup = (pickup - now) / (1000 * 60 * 60);

  const issues = [];
  const warnings = [];

  if (booking.status === "cancelled") {
    issues.push({ code: "CANCELLED", message: "This booking has been cancelled and cannot be modified." });
    return { allowed: false, issues, warnings, needsEscalation: false };
  }
  if (booking.status === "completed") {
    issues.push({ code: "COMPLETED", message: "This booking is completed. No modifications are possible." });
    return { allowed: false, issues, warnings, needsEscalation: false };
  }
  if (booking.status === "active") {
    issues.push({ code: "ACTIVE", message: "Your rental is currently active. Contact support for changes." });
    return { allowed: false, issues, warnings, needsEscalation: true };
  }
  if (hoursUntilPickup < 2) {
    issues.push({ code: "TOO_LATE", message: "Modifications must be made at least 2 hours before pickup." });
    return { allowed: false, issues, warnings, needsEscalation: hoursUntilPickup > 0 };
  }
  if (hoursUntilPickup < 6) {
    warnings.push({ code: "CLOSE_WINDOW", message: "Less than 6 hours until pickup. Some changes may be restricted." });
  }

  return { allowed: true, issues, warnings, needsEscalation: false };
}

function checkVehicleAvailability(newVehicleType, pickupDate, dropoffDate, bookingId) {
  // Simulate availability — certain vehicle types are "unavailable" based on date
  const dateHash = new Date(pickupDate).getDate();
  const unavailableTypes = ["luxury", "minivan"].filter((_, i) => (dateHash + i) % 4 === 0);

  if (unavailableTypes.includes(newVehicleType)) {
    return { available: false, reason: `${VEHICLE_TYPES[newVehicleType].label} class is unavailable for selected dates.` };
  }
  return { available: true };
}

function checkLocationAvailability(location) {
  const restricted = ["Harbor View"];
  if (restricted.includes(location)) {
    return { available: false, reason: `${location} is temporarily unavailable for pickup/dropoff.` };
  }
  return { available: true };
}

function calculateNewPrice(newData, originalBooking) {
  const pickup = new Date(`${newData.pickupDate}T${newData.pickupTime}`);
  const dropoff = new Date(`${newData.dropoffDate}T${newData.dropoffTime}`);
  const days = Math.max(1, Math.ceil((dropoff - pickup) / (1000 * 60 * 60 * 24)));
  const vehicleRate = VEHICLE_TYPES[newData.vehicleType].baseRate;
  const extrasTotal = newData.extras.reduce((s, k) => s + EXTRAS[k].rate, 0);
  const newTotal = days * vehicleRate + extrasTotal * days;
  const diff = newTotal - originalBooking.totalPrice;
  return { newTotal, days, vehicleRate, diff };
}

function runApprovalEngine(changes, booking, pricing) {
  const escalationReasons = [];
  const rejectionReasons = [];
  const requiresPayment = pricing.diff > 0;
  const requiresRefund = pricing.diff < 0;

  // Vehicle availability check
  if (changes.vehicleType !== booking.vehicleType) {
    const avail = checkVehicleAvailability(changes.vehicleType, changes.pickupDate, changes.dropoffDate, booking.id);
    if (!avail.available) {
      rejectionReasons.push({ code: "NO_FLEET", message: avail.reason });
    }
  }

  // Location check
  if (changes.pickupLocation !== booking.pickupLocation) {
    const avail = checkLocationAvailability(changes.pickupLocation);
    if (!avail.available) rejectionReasons.push({ code: "LOCATION_UNAVAILABLE", message: avail.reason });
  }
  if (changes.dropoffLocation !== booking.dropoffLocation) {
    const avail = checkLocationAvailability(changes.dropoffLocation);
    if (!avail.available) rejectionReasons.push({ code: "LOCATION_UNAVAILABLE", message: avail.reason });
  }

  // Large price increase — flag for manual review
  if (pricing.diff > 150) {
    escalationReasons.push({ code: "PRICING_MISMATCH", message: `Significant price increase of $${pricing.diff.toFixed(2)} requires review.` });
  }

  // VIP escalation
  if (booking.isVIP && rejectionReasons.length > 0) {
    escalationReasons.push({ code: "VIP_ESCALATION", message: "VIP customer — escalating to priority support team." });
  }

  if (rejectionReasons.length > 0) {
    return { outcome: "rejected", reasons: rejectionReasons, requiresPayment, requiresRefund, escalationReasons };
  }
  if (escalationReasons.length > 0) {
    return { outcome: "escalated", reasons: escalationReasons, requiresPayment, requiresRefund, escalationReasons };
  }
  return { outcome: "approved", reasons: [], requiresPayment, requiresRefund, escalationReasons: [] };
}

// ============================================================
// NOTIFICATION SYSTEM
// ============================================================

const NOTIFICATION_TEMPLATES = {
  RECEIVED: (b) => ({ type: "info", title: "Modification Request Received", body: `Your request to modify booking ${b.id} is being processed.` }),
  APPROVED: (b) => ({ type: "success", title: "Booking Updated Successfully", body: `Booking ${b.id} has been updated. A confirmation email will be sent to ${b.email}.` }),
  REJECTED: (b, reason) => ({ type: "danger", title: "Modification Not Possible", body: reason }),
  PAYMENT_REQUIRED: (b, amt) => ({ type: "warning", title: "Additional Payment Required", body: `An extra payment of $${Math.abs(amt).toFixed(2)} is required to complete this change.` }),
  REFUND_INITIATED: (b, amt) => ({ type: "success", title: "Refund Initiated", body: `A refund of $${Math.abs(amt).toFixed(2)} will be credited to your original payment method within 3-5 business days.` }),
  ESCALATED: (b) => ({ type: "warning", title: "Escalated to Customer Support", body: `Your request has been forwarded to a support agent who will contact you within 2 hours.` }),
};

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function BookingModificationSystem() {
  const [phase, setPhase] = useState("lookup"); // lookup | verify | modify | processing | result
  const [bookingId, setBookingId] = useState("");
  const [email, setEmail] = useState("");
  const [booking, setBooking] = useState(null);
  const [eligibility, setEligibility] = useState(null);
  const [changes, setChanges] = useState({});
  const [pricing, setPricing] = useState(null);
  const [result, setResult] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editAttempts, setEditAttempts] = useState(0);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const notifId = useRef(0);

  const addNotification = (notif) => {
    const id = ++notifId.current;
    setNotifications((n) => [...n, { ...notif, id }]);
    setTimeout(() => setNotifications((n) => n.filter((x) => x.id !== id)), 6000);
  };

  // ─── PHASE 1: Lookup ───────────────────────────────────────
  const handleLookup = () => {
    setError("");
    if (!bookingId.trim() || !email.trim()) {
      setError("Please enter both Booking ID and email address.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }

    setLoading(true);
    setTimeout(() => {
      const found = generateMockBooking(bookingId.trim(), email.trim());
      setBooking(found);
      const elig = checkModificationEligibility(found);
      setEligibility(elig);

      // Initialize changes from current booking
      setChanges({
        pickupDate: found.pickupDate,
        pickupTime: found.pickupTime,
        dropoffDate: found.dropoffDate,
        dropoffTime: found.dropoffTime,
        pickupLocation: found.pickupLocation,
        dropoffLocation: found.dropoffLocation,
        vehicleType: found.vehicleType,
        extras: [...found.extras],
        customerName: found.customerName,
        phone: found.phone,
        email: found.email,
      });
      setLoading(false);
      setPhase("verify");
    }, 1200);
  };

  // ─── PHASE 2: Update pricing as changes happen ────────────
  useEffect(() => {
    if (!booking || !changes.pickupDate) return;
    const p = calculateNewPrice(changes, booking);
    setPricing(p);
  }, [changes, booking]);

  const handleChangeField = (field, value) => {
    setChanges((prev) => ({ ...prev, [field]: value }));
  };

  const handleToggleExtra = (key) => {
    setChanges((prev) => ({
      ...prev,
      extras: prev.extras.includes(key) ? prev.extras.filter((e) => e !== key) : [...prev.extras, key],
    }));
  };

  // ─── PHASE 3: Submit modification ─────────────────────────
  const handleSubmit = () => {
    if (editAttempts >= 3) {
      addNotification({ type: "danger", title: "Too Many Attempts", body: "You've attempted multiple edits. Please contact customer support." });
      return;
    }
    setEditAttempts((a) => a + 1);
    setPhase("processing");
    addNotification(NOTIFICATION_TEMPLATES.RECEIVED(booking));

    setTimeout(() => {
      const approvalResult = runApprovalEngine(changes, booking, pricing);
      setResult(approvalResult);

      if (approvalResult.outcome === "approved") {
        if (approvalResult.requiresPayment) {
          addNotification(NOTIFICATION_TEMPLATES.PAYMENT_REQUIRED(booking, pricing.diff));
        } else if (approvalResult.requiresRefund) {
          addNotification(NOTIFICATION_TEMPLATES.REFUND_INITIATED(booking, pricing.diff));
          addNotification(NOTIFICATION_TEMPLATES.APPROVED(booking));
        } else {
          addNotification(NOTIFICATION_TEMPLATES.APPROVED(booking));
        }
      } else if (approvalResult.outcome === "rejected") {
        addNotification(NOTIFICATION_TEMPLATES.REJECTED(booking, approvalResult.reasons[0]?.message));
        if (approvalResult.escalationReasons.length > 0) {
          addNotification(NOTIFICATION_TEMPLATES.ESCALATED(booking));
        }
      } else if (approvalResult.outcome === "escalated") {
        addNotification(NOTIFICATION_TEMPLATES.ESCALATED(booking));
      }

      setPhase("result");
    }, 2000);
  };

  const handlePaymentConfirm = () => {
    setPaymentConfirmed(true);
    setTimeout(() => {
      addNotification(NOTIFICATION_TEMPLATES.APPROVED(booking));
      setResult((r) => ({ ...r, paymentDone: true }));
    }, 1000);
  };

  const resetAll = () => {
    setPhase("lookup");
    setBooking(null);
    setBookingId("");
    setEmail("");
    setChanges({});
    setPricing(null);
    setResult(null);
    setError("");
    setEditAttempts(0);
    setPaymentConfirmed(false);
  };

  // ──────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: "'Segoe UI', system-ui, sans-serif", minHeight: "100vh", background: "var(--color-background-tertiary)", padding: "0 0 3rem" }}>
      <h2 className="sr-only">Car Rental Booking Modification System</h2>

      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{ background: "var(--color-background-primary)", borderBottom: "0.5px solid var(--color-border-tertiary)", padding: "1rem 1.5rem", display: "flex", alignItems: "center", gap: "12px", marginBottom: "1.5rem" }}>
        <span style={{ fontSize: "22px" }}>🚗</span>
        <div>
          <div style={{ fontWeight: 500, fontSize: "16px", color: "var(--color-text-primary)" }}>DriveEasy Fleet</div>
          <div style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>Booking Modification Portal</div>
        </div>
        {booking && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
            <StepIndicator step={phase === "lookup" ? 1 : phase === "verify" ? 2 : phase === "modify" ? 3 : 4} />
          </div>
        )}
        {booking && (
          <button onClick={resetAll} style={{ marginLeft: "8px", fontSize: "12px", padding: "4px 12px", cursor: "pointer" }}>
            New Search
          </button>
        )}
      </div>

      {/* ── Notifications ──────────────────────────────────── */}
      <div style={{ position: "fixed", top: "1rem", right: "1rem", zIndex: 9999, display: "flex", flexDirection: "column", gap: "8px", maxWidth: "340px" }}>
        {notifications.map((n) => (
          <NotificationToast key={n.id} notif={n} />
        ))}
      </div>

      <div style={{ maxWidth: "860px", margin: "0 auto", padding: "0 1rem" }}>

        {/* ══ PHASE: LOOKUP ══════════════════════════════════ */}
        {phase === "lookup" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", border: "0.5px solid var(--color-border-tertiary)", padding: "2rem" }}>
              <div style={{ marginBottom: "1.5rem" }}>
                <h2 style={{ margin: "0 0 4px", fontSize: "18px", fontWeight: 500 }}>Modify your booking</h2>
                <p style={{ margin: 0, fontSize: "14px", color: "var(--color-text-secondary)" }}>Enter your booking reference and email to get started. Any booking ID and valid email will work.</p>
              </div>

              <div style={{ display: "grid", gap: "1rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "13px", color: "var(--color-text-secondary)", marginBottom: "6px" }}>Booking ID</label>
                  <input
                    value={bookingId}
                    onChange={(e) => setBookingId(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleLookup()}
                    placeholder="e.g. BK-2024-001 or any ID"
                    style={{ width: "100%", boxSizing: "border-box" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "13px", color: "var(--color-text-secondary)", marginBottom: "6px" }}>Email address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleLookup()}
                    placeholder="your@email.com"
                    style={{ width: "100%", boxSizing: "border-box" }}
                  />
                </div>
                {error && <div style={{ background: "var(--color-background-danger)", color: "var(--color-text-danger)", padding: "10px 14px", borderRadius: "var(--border-radius-md)", fontSize: "13px" }}><i className="ti ti-alert-circle" aria-hidden="true" /> {error}</div>}
                <button onClick={handleLookup} disabled={loading} style={{ background: "var(--color-text-primary)", color: "var(--color-background-primary)", border: "none", padding: "12px", borderRadius: "var(--border-radius-md)", fontWeight: 500, cursor: loading ? "wait" : "pointer", fontSize: "14px" }}>
                  {loading ? "Looking up booking…" : "Find My Booking"}
                </button>
              </div>
            </div>

            <InfoBox title="How it works" items={[
              "Enter any Booking ID and a valid email — the system generates a realistic mock booking",
              "Review your current booking details and eligibility",
              "Make changes and see real-time pricing updates",
              "Submit for instant approval or rejection with full explanation",
            ]} />
          </div>
        )}

        {/* ══ PHASE: VERIFY ══════════════════════════════════ */}
        {phase === "verify" && booking && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <BookingCard booking={booking} eligibility={eligibility} />

            {eligibility.allowed ? (
              <div style={{ display: "flex", gap: "12px" }}>
                <button onClick={() => setPhase("modify")} style={{ flex: 1, background: "var(--color-text-primary)", color: "var(--color-background-primary)", border: "none", padding: "12px", borderRadius: "var(--border-radius-md)", fontWeight: 500, cursor: "pointer" }}>
                  <i className="ti ti-edit" aria-hidden="true" /> Modify This Booking
                </button>
                <button onClick={resetAll} style={{ padding: "12px 20px", borderRadius: "var(--border-radius-md)", cursor: "pointer" }}>Cancel</button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: "12px" }}>
                {eligibility.needsEscalation && (
                  <button onClick={() => { addNotification(NOTIFICATION_TEMPLATES.ESCALATED(booking)); }} style={{ flex: 1, padding: "12px", borderRadius: "var(--border-radius-md)", background: "var(--color-background-warning)", color: "var(--color-text-warning)", border: "0.5px solid var(--color-border-warning)", cursor: "pointer", fontWeight: 500 }}>
                    <i className="ti ti-headset" aria-hidden="true" /> Contact Support
                  </button>
                )}
                <button onClick={resetAll} style={{ flex: 1, padding: "12px", borderRadius: "var(--border-radius-md)", cursor: "pointer" }}>Start Over</button>
              </div>
            )}
          </div>
        )}

        {/* ══ PHASE: MODIFY ══════════════════════════════════ */}
        {phase === "modify" && booking && changes && pricing && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: "1rem", alignItems: "start" }}>
            {/* Left: edit form */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {/* Dates & Times */}
              <FormSection title="Dates & Times" icon="ti-calendar">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <FieldGroup label="Pickup Date">
                    <input type="date" value={changes.pickupDate} onChange={(e) => handleChangeField("pickupDate", e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
                  </FieldGroup>
                  <FieldGroup label="Pickup Time">
                    <input type="time" value={changes.pickupTime} onChange={(e) => handleChangeField("pickupTime", e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
                  </FieldGroup>
                  <FieldGroup label="Drop-off Date">
                    <input type="date" value={changes.dropoffDate} onChange={(e) => handleChangeField("dropoffDate", e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
                  </FieldGroup>
                  <FieldGroup label="Drop-off Time">
                    <input type="time" value={changes.dropoffTime} onChange={(e) => handleChangeField("dropoffTime", e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
                  </FieldGroup>
                </div>
              </FormSection>

              {/* Locations */}
              <FormSection title="Pickup & Drop-off Locations" icon="ti-map-pin">
                <FieldGroup label="Pickup Location">
                  <select value={changes.pickupLocation} onChange={(e) => handleChangeField("pickupLocation", e.target.value)} style={{ width: "100%", boxSizing: "border-box" }}>
                    {LOCATIONS.map((l) => <option key={l}>{l}</option>)}
                  </select>
                </FieldGroup>
                <FieldGroup label="Drop-off Location" style={{ marginTop: "12px" }}>
                  <select value={changes.dropoffLocation} onChange={(e) => handleChangeField("dropoffLocation", e.target.value)} style={{ width: "100%", boxSizing: "border-box" }}>
                    {LOCATIONS.map((l) => <option key={l}>{l}</option>)}
                  </select>
                </FieldGroup>
                <InfoBox small items={["Harbor View is currently unavailable — selecting it will reject the modification."]} />
              </FormSection>

              {/* Vehicle */}
              <FormSection title="Vehicle Class" icon="ti-car">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
                  {Object.entries(VEHICLE_TYPES).map(([key, v]) => (
                    <button
                      key={key}
                      onClick={() => handleChangeField("vehicleType", key)}
                      style={{
                        padding: "12px 8px",
                        borderRadius: "var(--border-radius-md)",
                        border: changes.vehicleType === key ? "2px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
                        background: changes.vehicleType === key ? "var(--color-background-info)" : "var(--color-background-primary)",
                        cursor: "pointer",
                        textAlign: "center",
                      }}
                    >
                      <div style={{ fontSize: "20px", marginBottom: "4px" }}>{v.icon}</div>
                      <div style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-primary)" }}>{v.label}</div>
                      <div style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>${v.baseRate}/day</div>
                    </button>
                  ))}
                </div>
              </FormSection>

              {/* Extras */}
              <FormSection title="Extras & Add-ons" icon="ti-plus">
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {Object.entries(EXTRAS).map(([key, ex]) => (
                    <label key={key} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", cursor: "pointer", background: changes.extras?.includes(key) ? "var(--color-background-success)" : "var(--color-background-primary)" }}>
                      <input type="checkbox" checked={changes.extras?.includes(key) || false} onChange={() => handleToggleExtra(key)} />
                      <span style={{ fontSize: "16px" }}>{ex.icon}</span>
                      <span style={{ flex: 1, fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary)" }}>{ex.label}</span>
                      <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>+${ex.rate}/day</span>
                    </label>
                  ))}
                </div>
              </FormSection>

              {/* Driver Details */}
              <FormSection title="Driver & Contact Info" icon="ti-user">
                <div style={{ display: "grid", gap: "12px" }}>
                  <FieldGroup label="Full Name">
                    <input value={changes.customerName} onChange={(e) => handleChangeField("customerName", e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
                  </FieldGroup>
                  <FieldGroup label="Phone Number">
                    <input value={changes.phone} onChange={(e) => handleChangeField("phone", e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
                  </FieldGroup>
                  <FieldGroup label="Email Address">
                    <input type="email" value={changes.email} onChange={(e) => handleChangeField("email", e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
                  </FieldGroup>
                </div>
              </FormSection>

              {editAttempts >= 2 && (
                <div style={{ background: "var(--color-background-warning)", border: "0.5px solid var(--color-border-warning)", borderRadius: "var(--border-radius-md)", padding: "10px 14px", fontSize: "13px", color: "var(--color-text-warning)" }}>
                  <i className="ti ti-alert-triangle" aria-hidden="true" /> Warning: You have {3 - editAttempts} modification attempt(s) remaining before your account is locked.
                </div>
              )}

              <div style={{ display: "flex", gap: "12px" }}>
                <button onClick={handleSubmit} style={{ flex: 1, background: "var(--color-text-primary)", color: "var(--color-background-primary)", border: "none", padding: "12px", borderRadius: "var(--border-radius-md)", fontWeight: 500, cursor: "pointer" }}>
                  Submit Modification Request
                </button>
                <button onClick={() => setPhase("verify")} style={{ padding: "12px 20px", borderRadius: "var(--border-radius-md)", cursor: "pointer" }}>Back</button>
              </div>
            </div>

            {/* Right: pricing summary */}
            <div style={{ position: "sticky", top: "1rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
              <PricingSummary booking={booking} changes={changes} pricing={pricing} />
              <ChangeSummary booking={booking} changes={changes} />
            </div>
          </div>
        )}

        {/* ══ PHASE: PROCESSING ══════════════════════════════ */}
        {phase === "processing" && (
          <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "3rem", textAlign: "center" }}>
            <div style={{ fontSize: "40px", marginBottom: "1rem" }}>⚙️</div>
            <div style={{ fontWeight: 500, fontSize: "16px", marginBottom: "8px" }}>Processing your modification</div>
            <div style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>Checking fleet availability, pricing, and policy compliance…</div>
            <div style={{ marginTop: "1.5rem", display: "flex", justifyContent: "center", gap: "6px" }}>
              {[0, 1, 2].map((i) => <div key={i} style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--color-text-secondary)", animation: `pulse 1.2s ${i * 0.2}s infinite` }} />)}
            </div>
            <style>{`@keyframes pulse { 0%,100%{opacity:.3} 50%{opacity:1} }`}</style>
          </div>
        )}

        {/* ══ PHASE: RESULT ══════════════════════════════════ */}
        {phase === "result" && result && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <ResultCard result={result} booking={booking} pricing={pricing} changes={changes} paymentConfirmed={paymentConfirmed} onPaymentConfirm={handlePaymentConfirm} onReset={resetAll} onRetry={() => { setPhase("modify"); setResult(null); }} />
          </div>
        )}

      </div>
    </div>
  );
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function StepIndicator({ step }) {
  const steps = ["Lookup", "Review", "Modify", "Confirm"];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      {steps.map((s, i) => (
        <div key={s} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{ width: "22px", height: "22px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 500, background: i + 1 <= step ? "var(--color-text-primary)" : "var(--color-background-secondary)", color: i + 1 <= step ? "var(--color-background-primary)" : "var(--color-text-secondary)", border: "0.5px solid var(--color-border-tertiary)" }}>
            {i + 1 <= step ? (i + 1 < step ? <i className="ti ti-check" aria-hidden="true" style={{ fontSize: "11px" }} /> : i + 1) : i + 1}
          </div>
          <span style={{ fontSize: "11px", color: i + 1 <= step ? "var(--color-text-primary)" : "var(--color-text-secondary)" }}>{s}</span>
          {i < steps.length - 1 && <div style={{ width: "16px", height: "0.5px", background: "var(--color-border-tertiary)" }} />}
        </div>
      ))}
    </div>
  );
}

function BookingCard({ booking, eligibility }) {
  const statusColors = {
    confirmed: { bg: "var(--color-background-success)", text: "var(--color-text-success)", label: "Confirmed" },
    active: { bg: "var(--color-background-info)", text: "var(--color-text-info)", label: "Active" },
    completed: { bg: "var(--color-background-secondary)", text: "var(--color-text-secondary)", label: "Completed" },
    cancelled: { bg: "var(--color-background-danger)", text: "var(--color-text-danger)", label: "Cancelled" },
  };
  const sc = statusColors[booking.status];
  const vehicle = VEHICLE_TYPES[booking.vehicleType];

  return (
    <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", border: "0.5px solid var(--color-border-tertiary)", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "1rem 1.25rem", borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", alignItems: "center", gap: "12px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontWeight: 500, fontSize: "15px" }}>{booking.id}</span>
            {booking.isVIP && <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "var(--border-radius-md)", background: "var(--color-background-warning)", color: "var(--color-text-warning)" }}>VIP</span>}
            <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "var(--border-radius-md)", background: sc.bg, color: sc.text }}>{sc.label}</span>
          </div>
          <div style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginTop: "2px" }}>{booking.customerName} · {booking.email}</div>
        </div>
        <div style={{ marginLeft: "auto", fontSize: "28px" }}>{vehicle.icon}</div>
      </div>

      {/* Details grid */}
      <div style={{ padding: "1rem 1.25rem", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <DetailItem icon="ti-calendar" label="Pickup" value={`${booking.pickupDate} at ${booking.pickupTime}`} />
        <DetailItem icon="ti-calendar-due" label="Drop-off" value={`${booking.dropoffDate} at ${booking.dropoffTime}`} />
        <DetailItem icon="ti-map-pin" label="Pickup Location" value={booking.pickupLocation} />
        <DetailItem icon="ti-map-pin-2" label="Drop-off Location" value={booking.dropoffLocation} />
        <DetailItem icon="ti-car" label="Vehicle" value={`${vehicle.label} — ${booking.vehicleModel}`} />
        <DetailItem icon="ti-license" label="Plate" value={booking.plateNumber} />
        <DetailItem icon="ti-currency-dollar" label="Total Paid" value={`$${booking.totalPrice.toFixed(2)}`} />
        <DetailItem icon="ti-clock" label="Duration" value={`${booking.totalDays} day${booking.totalDays !== 1 ? "s" : ""}`} />
      </div>

      {booking.extras.length > 0 && (
        <div style={{ padding: "0 1.25rem 1rem", display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {booking.extras.map((k) => (
            <span key={k} style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "var(--border-radius-md)", background: "var(--color-background-secondary)", color: "var(--color-text-secondary)" }}>
              {EXTRAS[k].icon} {EXTRAS[k].label}
            </span>
          ))}
        </div>
      )}

      {/* Eligibility */}
      {!eligibility.allowed && (
        <div style={{ margin: "0 1.25rem 1rem", background: "var(--color-background-danger)", border: "0.5px solid var(--color-border-danger)", borderRadius: "var(--border-radius-md)", padding: "12px" }}>
          {eligibility.issues.map((iss, i) => (
            <div key={i} style={{ fontSize: "13px", color: "var(--color-text-danger)", display: "flex", alignItems: "flex-start", gap: "6px" }}>
              <i className="ti ti-ban" aria-hidden="true" />
              {iss.message}
            </div>
          ))}
        </div>
      )}
      {eligibility.allowed && eligibility.warnings.length > 0 && (
        <div style={{ margin: "0 1.25rem 1rem", background: "var(--color-background-warning)", border: "0.5px solid var(--color-border-warning)", borderRadius: "var(--border-radius-md)", padding: "12px" }}>
          {eligibility.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: "13px", color: "var(--color-text-warning)" }}><i className="ti ti-alert-triangle" aria-hidden="true" /> {w.message}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function DetailItem({ icon, label, value }) {
  return (
    <div>
      <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "2px", display: "flex", alignItems: "center", gap: "4px" }}>
        <i className={`ti ${icon}`} aria-hidden="true" style={{ fontSize: "12px" }} />{label}
      </div>
      <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary)" }}>{value}</div>
    </div>
  );
}

function FormSection({ title, icon, children }) {
  return (
    <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", border: "0.5px solid var(--color-border-tertiary)", padding: "1.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "1rem" }}>
        <i className={`ti ${icon}`} aria-hidden="true" style={{ fontSize: "16px", color: "var(--color-text-secondary)" }} />
        <span style={{ fontWeight: 500, fontSize: "14px" }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function FieldGroup({ label, children, style }) {
  return (
    <div style={style}>
      <label style={{ display: "block", fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>{label}</label>
      {children}
    </div>
  );
}

function PricingSummary({ booking, changes, pricing }) {
  const diffColor = pricing.diff > 0 ? "var(--color-text-danger)" : pricing.diff < 0 ? "var(--color-text-success)" : "var(--color-text-secondary)";
  return (
    <div style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", border: "0.5px solid var(--color-border-tertiary)", padding: "1.25rem" }}>
      <div style={{ fontWeight: 500, fontSize: "14px", marginBottom: "1rem" }}>Pricing Summary</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" }}>
        <Row label="Vehicle rate" value={`$${pricing.vehicleRate}/day`} />
        <Row label="Duration" value={`${pricing.days} day${pricing.days !== 1 ? "s" : ""}`} />
        <Row label="Extras" value={changes.extras?.length > 0 ? changes.extras.map((k) => EXTRAS[k].label).join(", ") : "None"} small />
        <div style={{ borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: "8px" }}>
          <Row label="New total" value={`$${pricing.newTotal.toFixed(2)}`} bold />
          <Row label="Original total" value={`$${booking.totalPrice.toFixed(2)}`} muted />
        </div>
        {pricing.diff !== 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 500, color: diffColor }}>
            <span>{pricing.diff > 0 ? "Amount due" : "Refund amount"}</span>
            <span>{pricing.diff > 0 ? "+" : ""}{pricing.diff.toFixed(2) === "0.00" ? "" : `$${Math.abs(pricing.diff).toFixed(2)}`}</span>
          </div>
        )}
        {pricing.diff === 0 && <div style={{ color: "var(--color-text-success)", fontSize: "12px" }}><i className="ti ti-check" aria-hidden="true" /> No price change</div>}
      </div>
    </div>
  );
}

function Row({ label, value, bold, muted, small }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
      <span style={{ color: muted ? "var(--color-text-secondary)" : "var(--color-text-primary)", fontWeight: bold ? 500 : 400, fontSize: small ? "12px" : "13px" }}>{label}</span>
      <span style={{ color: muted ? "var(--color-text-secondary)" : "var(--color-text-primary)", fontWeight: bold ? 500 : 400, fontSize: small ? "12px" : "13px", textAlign: "right", maxWidth: "120px", wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

function ChangeSummary({ booking, changes }) {
  const diffs = [];
  if (changes.pickupDate !== booking.pickupDate || changes.pickupTime !== booking.pickupTime)
    diffs.push(`Pickup: ${changes.pickupDate} ${changes.pickupTime}`);
  if (changes.dropoffDate !== booking.dropoffDate || changes.dropoffTime !== booking.dropoffTime)
    diffs.push(`Drop-off: ${changes.dropoffDate} ${changes.dropoffTime}`);
  if (changes.pickupLocation !== booking.pickupLocation) diffs.push(`Pickup loc: ${changes.pickupLocation}`);
  if (changes.dropoffLocation !== booking.dropoffLocation) diffs.push(`Drop-off loc: ${changes.dropoffLocation}`);
  if (changes.vehicleType !== booking.vehicleType) diffs.push(`Vehicle: ${VEHICLE_TYPES[changes.vehicleType].label}`);
  if (JSON.stringify(changes.extras) !== JSON.stringify(booking.extras)) diffs.push("Extras updated");
  if (changes.customerName !== booking.customerName) diffs.push("Name updated");
  if (changes.phone !== booking.phone) diffs.push("Phone updated");

  if (diffs.length === 0) return null;

  return (
    <div style={{ background: "var(--color-background-info)", border: "0.5px solid var(--color-border-info)", borderRadius: "var(--border-radius-lg)", padding: "1rem 1.25rem" }}>
      <div style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-info)", marginBottom: "8px" }}>Changes detected</div>
      {diffs.map((d, i) => (
        <div key={i} style={{ fontSize: "12px", color: "var(--color-text-info)", padding: "2px 0" }}><i className="ti ti-arrow-right" aria-hidden="true" /> {d}</div>
      ))}
    </div>
  );
}

function ResultCard({ result, booking, pricing, changes, paymentConfirmed, onPaymentConfirm, onReset, onRetry }) {
  const isApproved = result.outcome === "approved";
  const isRejected = result.outcome === "rejected";
  const isEscalated = result.outcome === "escalated";

  const outcomeConfig = {
    approved: { icon: "✅", title: "Modification Approved", bg: "var(--color-background-success)", border: "var(--color-border-success)", textColor: "var(--color-text-success)" },
    rejected: { icon: "❌", title: "Modification Rejected", bg: "var(--color-background-danger)", border: "var(--color-border-danger)", textColor: "var(--color-text-danger)" },
    escalated: { icon: "🔄", title: "Escalated to Support", bg: "var(--color-background-warning)", border: "var(--color-border-warning)", textColor: "var(--color-text-warning)" },
  }[result.outcome];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Outcome banner */}
      <div style={{ background: outcomeConfig.bg, border: `0.5px solid ${outcomeConfig.border}`, borderRadius: "var(--border-radius-lg)", padding: "1.5rem", textAlign: "center" }}>
        <div style={{ fontSize: "32px", marginBottom: "8px" }}>{outcomeConfig.icon}</div>
        <div style={{ fontWeight: 500, fontSize: "16px", color: outcomeConfig.textColor }}>{outcomeConfig.title}</div>
        {isApproved && !result.requiresPayment && (
          <div style={{ fontSize: "13px", color: outcomeConfig.textColor, marginTop: "4px" }}>Your booking has been updated successfully.</div>
        )}
        {isRejected && result.reasons.map((r, i) => (
          <div key={i} style={{ fontSize: "13px", color: outcomeConfig.textColor, marginTop: "4px" }}>{r.message}</div>
        ))}
        {isEscalated && result.reasons.map((r, i) => (
          <div key={i} style={{ fontSize: "13px", color: outcomeConfig.textColor, marginTop: "4px" }}>{r.message}</div>
        ))}
      </div>

      {/* Payment required block */}
      {isApproved && result.requiresPayment && !paymentConfirmed && (
        <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1.5rem" }}>
          <div style={{ fontWeight: 500, marginBottom: "8px" }}>Additional Payment Required</div>
          <div style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginBottom: "1rem" }}>
            Your modification results in an additional charge of <strong>${Math.abs(pricing.diff).toFixed(2)}</strong>. Please confirm payment to complete the modification.
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={onPaymentConfirm} style={{ flex: 1, background: "var(--color-text-primary)", color: "var(--color-background-primary)", border: "none", padding: "10px", borderRadius: "var(--border-radius-md)", fontWeight: 500, cursor: "pointer" }}>
              Pay ${Math.abs(pricing.diff).toFixed(2)} & Confirm
            </button>
            <button onClick={onRetry} style={{ padding: "10px 16px", borderRadius: "var(--border-radius-md)", cursor: "pointer" }}>Edit Changes</button>
          </div>
        </div>
      )}

      {isApproved && result.requiresPayment && paymentConfirmed && (
        <div style={{ background: "var(--color-background-success)", border: "0.5px solid var(--color-border-success)", borderRadius: "var(--border-radius-lg)", padding: "1rem", fontSize: "13px", color: "var(--color-text-success)" }}>
          <i className="ti ti-check" aria-hidden="true" /> Payment of ${Math.abs(pricing.diff).toFixed(2)} confirmed. Booking updated successfully.
        </div>
      )}

      {isApproved && result.requiresRefund && (
        <div style={{ background: "var(--color-background-info)", border: "0.5px solid var(--color-border-info)", borderRadius: "var(--border-radius-lg)", padding: "1rem", fontSize: "13px", color: "var(--color-text-info)" }}>
          <i className="ti ti-arrow-back" aria-hidden="true" /> A refund of ${Math.abs(pricing.diff).toFixed(2)} has been initiated and will appear in 3–5 business days.
        </div>
      )}

      {/* Updated summary */}
      {isApproved && (
        <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1.25rem" }}>
          <div style={{ fontWeight: 500, fontSize: "14px", marginBottom: "1rem" }}>Updated Booking Summary</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <DetailItem icon="ti-calendar" label="New Pickup" value={`${changes.pickupDate} at ${changes.pickupTime}`} />
            <DetailItem icon="ti-calendar-due" label="New Drop-off" value={`${changes.dropoffDate} at ${changes.dropoffTime}`} />
            <DetailItem icon="ti-map-pin" label="Pickup Location" value={changes.pickupLocation} />
            <DetailItem icon="ti-map-pin-2" label="Drop-off Location" value={changes.dropoffLocation} />
            <DetailItem icon="ti-car" label="Vehicle" value={VEHICLE_TYPES[changes.vehicleType].label} />
            <DetailItem icon="ti-currency-dollar" label="New Total" value={`$${pricing.newTotal.toFixed(2)}`} />
          </div>
        </div>
      )}

      {/* Escalation details */}
      {(isEscalated || result.escalationReasons.length > 0) && (
        <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1.25rem" }}>
          <div style={{ fontWeight: 500, fontSize: "14px", marginBottom: "8px" }}>Support Escalation</div>
          <div style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginBottom: "8px" }}>A customer support agent will contact you at {booking.email} within 2 business hours. Reference number: <strong>{booking.id}-ESC</strong></div>
          {result.escalationReasons.map((r, i) => (
            <div key={i} style={{ fontSize: "12px", color: "var(--color-text-secondary)", padding: "2px 0" }}><i className="ti ti-arrow-right" aria-hidden="true" /> {r.message}</div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: "8px" }}>
        <button onClick={onReset} style={{ flex: 1, padding: "12px", borderRadius: "var(--border-radius-md)", cursor: "pointer", fontWeight: 500 }}>Start New Search</button>
        {(isRejected || isEscalated) && (
          <button onClick={onRetry} style={{ flex: 1, padding: "12px", borderRadius: "var(--border-radius-md)", cursor: "pointer", background: "var(--color-background-info)", color: "var(--color-text-info)", border: "0.5px solid var(--color-border-info)", fontWeight: 500 }}>
            Try Different Changes
          </button>
        )}
      </div>
    </div>
  );
}

function NotificationToast({ notif }) {
  const colors = {
    success: { bg: "var(--color-background-success)", border: "var(--color-border-success)", text: "var(--color-text-success)" },
    danger: { bg: "var(--color-background-danger)", border: "var(--color-border-danger)", text: "var(--color-text-danger)" },
    warning: { bg: "var(--color-background-warning)", border: "var(--color-border-warning)", text: "var(--color-text-warning)" },
    info: { bg: "var(--color-background-info)", border: "var(--color-border-info)", text: "var(--color-text-info)" },
  };
  const c = colors[notif.type] || colors.info;
  return (
    <div style={{ background: c.bg, border: `0.5px solid ${c.border}`, borderRadius: "var(--border-radius-lg)", padding: "12px 14px", boxShadow: "none", animation: "slideIn .2s ease" }}>
      <div style={{ fontWeight: 500, fontSize: "13px", color: c.text, marginBottom: "2px" }}>{notif.title}</div>
      <div style={{ fontSize: "12px", color: c.text, opacity: 0.9 }}>{notif.body}</div>
      <style>{`@keyframes slideIn { from{opacity:0;transform:translateX(20px)} to{opacity:1;transform:none} }`}</style>
    </div>
  );
}

function InfoBox({ title, items, small }) {
  return (
    <div style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: small ? "8px 12px" : "1rem 1.25rem", marginTop: small ? "8px" : 0 }}>
      {title && <div style={{ fontWeight: 500, fontSize: "13px", marginBottom: "8px" }}>{title}</div>}
      {items.map((item, i) => (
        <div key={i} style={{ fontSize: small ? "11px" : "13px", color: "var(--color-text-secondary)", display: "flex", gap: "8px", padding: "3px 0" }}>
          <span>·</span><span>{item}</span>
        </div>
      ))}
    </div>
  );
}
