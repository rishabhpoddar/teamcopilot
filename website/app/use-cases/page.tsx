import Navbar from "../components/Navbar";
import UseCasesContent from "../components/UseCasesContent";

export default function UseCasesPage() {
  return (
    <>
      <Navbar currentPage="use-cases" />
      <UseCasesContent />
    </>
  );
}
