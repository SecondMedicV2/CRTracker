import FlyerClient from "./FlyerClient";

export async function generateStaticParams() {
  return [
    { code: "CP02_PREDIABETES" },
    { code: "CP03_HYPERTENSION" },
    { code: "CP04_CHOLESTEROL" },
    { code: "CP05_LIFESTYLE_WEIGHT" },
    { code: "CP06_MEDICAL_WEIGHT" },
    { code: "CP07_DIET_NUTRITION" },
    { code: "CP08_THYROID" },
    { code: "CP09_PCOS" },
    { code: "CP10_LIVER" },
    { code: "CP11_SENIOR" },
    { code: "CP12_MOVE" },
  ];
}

export default function CarePlanFlyerPage({ params }: { params: Promise<{ code: string }> }) {
  return <FlyerClient params={params} />;
}
