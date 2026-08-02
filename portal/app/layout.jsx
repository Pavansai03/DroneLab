import "./globals.css";

export const metadata = {
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
