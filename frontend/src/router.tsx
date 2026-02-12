import { createBrowserRouter } from "react-router-dom";
import Home from "./pages/Home";
import Board from "./pages/Board";

export const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  { path: "/board/:id", element: <Board /> },
]);
