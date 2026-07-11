import { createBrowserRouter } from "react-router";

import { RootLayout } from "./shell/RootLayout";
import { viraRoutes } from "./routing/route-manifest";

export const router = createBrowserRouter([
  {
    Component: RootLayout,
    children: viraRoutes.map((route) => ({
      id: route.id,
      index: route.index,
      path: route.path,
      Component: route.component,
    })),
  },
]);
