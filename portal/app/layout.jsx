import "./globals.css";

export const metadata = {
  /* The tab icon is the company's, not the product's — it is the thing anyone
     scanning a row of tabs will recognise. */
  icons: { icon: "/brand/logo-mark.png", apple: "/brand/logo-mark.png" },
  title: "DroneLab — Portal",
  description: "Student progress, school dashboards and administration for DroneLab.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
