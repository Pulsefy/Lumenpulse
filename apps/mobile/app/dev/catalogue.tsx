import React, { useState } from 'react';
import { FlatList, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, useRouter } from 'expo-router';
import BiometricLockGuard from '../../components/BiometricLockGuard';
import CachedImage from '../../components/CachedImage';
import ContributionModal from '../../components/ContributionModal';
import ListError from '../../components/ListError';
import ListSkeleton from '../../components/ListSkeleton';
import NetworkBadge from '../../components/NetworkBadge';
import ProtectedRoute from '../../components/ProtectedRoute';
import ReportContentModal from '../../components/ReportContentModal';
import ReviewerGate from '../../components/ReviewerGate';
import StandardList from '../../components/StandardList';
import { useAuth } from '../../contexts/AuthContext';
import {
  CATALOGUE_ENTRIES,
  CATALOGUE_EXEMPT,
  CatalogueEntry,
  CatalogueVariant,
  isCatalogueEnabled,
} from '../../lib/component-catalogue';
import { ReportType } from '../../lib/moderation';
import { useLocalization } from '../../src/context';

/**
 * Development-only screen that renders every shared component in its states,
 * from the list in `lib/component-catalogue.ts`. Release builds redirect home.
 */

interface SampleRow {
  id: string;
  title: string;
}

const SAMPLE_ROWS: SampleRow[] = [
  { id: '1', title: 'Protocol upgrade vote opens' },
  { id: '2', title: 'New community grant round' },
  { id: '3', title: 'Soroban fee changes explained' },
];

const noop = () => {};

function VariantFrame({ label, children }: { label: string; children: React.ReactNode }) {
  const { colors } = useLocalization();

  return (
    <View style={styles.variant}>
      <Text style={[styles.variantLabel, { color: colors.textSecondary }]}>{label}</Text>
      <View style={[styles.variantBody, { borderColor: colors.border }]}>{children}</View>
    </View>
  );
}

function SampleListRow({ item }: { item: SampleRow }) {
  const { colors } = useLocalization();

  return (
    <View style={[styles.sampleRow, { borderColor: colors.border }]}>
      <Text style={{ color: colors.text }}>{item.title}</Text>
    </View>
  );
}

function StandardListPreview({ variant }: { variant: CatalogueVariant }) {
  const listProps = {
    renderItem: ({ item }: { item: SampleRow }) => <SampleListRow item={item} />,
    keyExtractor: (item: SampleRow) => item.id,
  };

  switch (variant) {
    case 'loading':
      return <StandardList<SampleRow> data={[]} loading {...listProps} />;
    case 'empty':
      return <StandardList<SampleRow> data={[]} {...listProps} />;
    case 'error':
      return (
        <StandardList<SampleRow>
          data={[]}
          error="Could not load the list."
          onRetry={noop}
          {...listProps}
        />
      );
    default:
      return <StandardList<SampleRow> data={SAMPLE_ROWS} itemHeight={48} {...listProps} />;
  }
}

function ToggleButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useLocalization();

  return (
    <TouchableOpacity
      style={[styles.toggleButton, { backgroundColor: colors.accent }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={[styles.toggleButtonText, { color: colors.onAccent }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function GuardChild({ text }: { text: string }) {
  const { colors } = useLocalization();
  return <Text style={[styles.note, { color: colors.text }]}>{text}</Text>;
}

function EntryPreview({ entry }: { entry: CatalogueEntry }) {
  const { colors } = useLocalization();
  const { isAuthenticated } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [guardMounted, setGuardMounted] = useState(false);
  const [reviewerMounted, setReviewerMounted] = useState(false);

  switch (entry.name) {
    case 'StandardList':
      return (
        <>
          {entry.variants.map((variant) => (
            <VariantFrame key={variant} label={variant}>
              <StandardListPreview variant={variant} />
            </VariantFrame>
          ))}
        </>
      );
    case 'ListSkeleton':
      return (
        <VariantFrame label="loading (count 3)">
          <ListSkeleton count={3} />
        </VariantFrame>
      );
    case 'ListError':
      return (
        <>
          <VariantFrame label="error with retry">
            <ListError message="Could not load projects." onRetry={noop} />
          </VariantFrame>
          <VariantFrame label="error without retry">
            <ListError message="Could not load projects." />
          </VariantFrame>
        </>
      );
    case 'NetworkBadge':
      return (
        <VariantFrame label="default (active network)">
          <View style={styles.badgeArea}>
            <NetworkBadge />
          </View>
        </VariantFrame>
      );
    case 'CachedImage':
      return (
        <VariantFrame label="empty (no URI, placeholder)">
          <CachedImage uri={null} width={96} height={64} borderRadius={8} />
        </VariantFrame>
      );
    case 'ContributionModal':
      return (
        <VariantFrame label="default">
          <ToggleButton label="Open contribution modal" onPress={() => setModalOpen(true)} />
          <ContributionModal
            visible={modalOpen}
            projectId={0}
            projectName="Catalogue sample project"
            onClose={() => setModalOpen(false)}
            onSubmit={async () => ({ errorMessage: 'Catalogue preview: nothing was submitted.' })}
          />
        </VariantFrame>
      );
    case 'ReportContentModal':
      return (
        <VariantFrame label="default">
          <ToggleButton label="Open report modal" onPress={() => setModalOpen(true)} />
          <ReportContentModal
            visible={modalOpen}
            targetType={ReportType.OTHER}
            targetId="catalogue-sample"
            targetLabel="Catalogue sample content"
            onClose={() => setModalOpen(false)}
          />
        </VariantFrame>
      );
    case 'ProtectedRoute':
      return (
        <VariantFrame label="populated (signed in, children shown)">
          {isAuthenticated ? (
            <ProtectedRoute>
              <GuardChild text="Protected content for a signed-in user." />
            </ProtectedRoute>
          ) : (
            // Mounting the guard while signed out would redirect away from this
            // screen (ProtectedRoute.tsx line 24), so that state is described.
            <Text style={[styles.note, { color: colors.textSecondary }]}>
              Signed out: ProtectedRoute redirects to /auth/login instead of rendering its
              children. Sign in to see the pass-through state here.
            </Text>
          )}
        </VariantFrame>
      );
    case 'BiometricLockGuard':
      return (
        <VariantFrame label="populated (lock disabled, children shown)">
          {guardMounted ? (
            <BiometricLockGuard>
              <GuardChild text="Content behind the biometric lock." />
            </BiometricLockGuard>
          ) : (
            // Mounted on demand: with the lock enabled in Settings the guard
            // asks for biometrics as soon as it mounts.
            <ToggleButton label="Mount BiometricLockGuard" onPress={() => setGuardMounted(true)} />
          )}
        </VariantFrame>
      );
    case 'ReviewerGate':
      return (
        <VariantFrame label="populated (reviewer, children shown)">
          {reviewerMounted ? (
            <ReviewerGate>
              <GuardChild text="Reviewer-only content." />
            </ReviewerGate>
          ) : (
            // Mounted on demand: a non-reviewer account is redirected home by
            // the guard (ReviewerGate.tsx), so it is opt-in.
            <ToggleButton label="Mount ReviewerGate" onPress={() => setReviewerMounted(true)} />
          )}
        </VariantFrame>
      );
    default:
      return (
        <Text style={[styles.note, { color: colors.textSecondary }]}>
          No preview yet: add one in app/dev/catalogue.tsx.
        </Text>
      );
  }
}

function CatalogueCard({ entry }: { entry: CatalogueEntry }) {
  const { colors } = useLocalization();

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.cardTitle, { color: colors.text }]}>{entry.name}</Text>
      <Text style={[styles.cardMeta, { color: colors.textSecondary }]}>
        components/{entry.file}: {entry.description}
      </Text>
      <EntryPreview entry={entry} />
    </View>
  );
}

export default function ComponentCatalogueScreen() {
  const router = useRouter();
  const { colors } = useLocalization();

  if (!isCatalogueEnabled()) {
    return <Redirect href="/" />;
  }

  const exemptions = Object.entries(CATALOGUE_EXEMPT);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* A FlatList, not a ScrollView, so the StandardList previews are not
          virtualized lists nested in a plain ScrollView. */}
      <FlatList
        data={CATALOGUE_ENTRIES}
        keyExtractor={(entry) => entry.file}
        renderItem={({ item }) => <CatalogueCard entry={item} />}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <TouchableOpacity
              style={[styles.headerButton, { backgroundColor: colors.card }]}
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="arrow-back" size={20} color={colors.text} />
            </TouchableOpacity>
            <View style={styles.headerCopy}>
              <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
                Component catalogue
              </Text>
              <Text style={[styles.cardMeta, { color: colors.textSecondary }]}>
                Development builds only. Entries come from lib/component-catalogue.ts.
              </Text>
            </View>
          </View>
        }
        ListFooterComponent={
          <View
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text style={[styles.cardTitle, { color: colors.text }]}>Not in the catalogue</Text>
            {exemptions.map(([file, reason]) => (
              <Text key={file} style={[styles.cardMeta, { color: colors.textSecondary }]}>
                components/{file}: {reason}
              </Text>
            ))}
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 48,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardMeta: {
    fontSize: 13,
    marginBottom: 8,
  },
  variant: {
    marginTop: 8,
  },
  variantLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  variantBody: {
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  sampleRow: {
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
  },
  badgeArea: {
    height: 96,
  },
  toggleButton: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    margin: 12,
  },
  toggleButtonText: {
    fontWeight: '600',
  },
  note: {
    fontSize: 13,
    padding: 12,
  },
});
