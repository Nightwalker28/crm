import MessageTemplateRecordFormPage from "@/components/settings/message-templates/MessageTemplateRecordFormPage";

export default async function EditMessageTemplatePage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  return <MessageTemplateRecordFormPage templateId={Number(templateId)} />;
}
