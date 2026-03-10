import Navbar from "./components/Navbar";
import Hero from "./components/Hero";

export default function Home() {
  return (
    <main className="bg-black">
      <Navbar currentPage="home" />
      <Hero />
    </main>
  );
}
