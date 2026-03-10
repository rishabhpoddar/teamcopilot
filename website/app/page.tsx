import Navbar from "./components/Navbar";
import Hero from "./components/Hero";

export default function Home() {
  return (
    <main className="bg-blue-600">
      <Navbar currentPage="home" />
      <Hero />
    </main>
  );
}
