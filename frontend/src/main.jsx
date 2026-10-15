import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import VolunteerSignup from "./VolunteerSignup.jsx";
import Renewal from "./Renewal.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {/^\/renew\/[a-f0-9]{64}$/.test(window.location.pathname) ? (
      <Renewal />
    ) : /^\/volunteers(?:\/|$)/.test(window.location.pathname) ? (
      <VolunteerSignup />
    ) : (
      <App />
    )}
  </StrictMode>,
);
