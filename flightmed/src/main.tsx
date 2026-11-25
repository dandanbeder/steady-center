import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./styles.css";
import { AppShell } from "./components/AppShell";
import { Dashboard } from "./pages/Dashboard";
import { CasesList } from "./pages/CasesList";
import { CaseIntake } from "./pages/CaseIntake";
import { CaseDetail } from "./pages/CaseDetail";
import { CrewPage } from "./pages/Crew";
import { AircraftPage } from "./pages/Aircraft";
import { NotFound } from "./pages/NotFound";

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <Dashboard /> },
      { path: "/dashboard", element: <Dashboard /> },
      { path: "/cases", element: <CasesList /> },
      { path: "/cases/new", element: <CaseIntake /> },
      { path: "/cases/:id", element: <CaseDetail /> },
      { path: "/crew", element: <CrewPage /> },
      { path: "/aircraft", element: <AircraftPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
