import { Footer } from "@/components/footer";
import { Navbar } from "@/components/navbar";
import { Raleway } from "next/font/google";

const raleway = Raleway({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-raleway",
});

export default function NewsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`min-h-screen flex flex-col ${raleway.className}`}>
      <Navbar />
      <main className="flex-grow">{children}</main>
      <Footer />
    </div>
  );
}

