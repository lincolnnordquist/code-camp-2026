import { Route, Routes } from "react-router-dom";
import { OrderDetail } from "./OrderDetail";
import { OrderQueue } from "./OrderQueue";
import { Pickup } from "./Pickup";
import { SignIn } from "./SignIn";
import { Stock } from "./Stock";
import { VendorLayout } from "./VendorLayout";
import { VendorProvider } from "./vendorSession";
import "./vendor.css";

// The vendor area, at /vendor. It has its own frame, so it does not use the attendee shell.
export default function VendorApp() {
  return (
    <VendorProvider>
      <Routes>
        <Route path="/vendor" element={<SignIn />} />
        <Route element={<VendorLayout />}>
          <Route path="/vendor/orders" element={<OrderQueue />} />
          <Route path="/vendor/orders/:orderId" element={<OrderDetail />} />
          <Route path="/vendor/pickup" element={<Pickup />} />
          <Route path="/vendor/stock" element={<Stock />} />
        </Route>
        <Route path="*" element={<SignIn />} />
      </Routes>
    </VendorProvider>
  );
}
