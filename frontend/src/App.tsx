import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { ThemeToggle } from "./components/ThemeToggle";

export default function App() {
  return (
    <>
      <RouterProvider router={router} />
      <ThemeToggle />
    </>
  );
}
