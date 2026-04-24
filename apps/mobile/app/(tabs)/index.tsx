/* eslint-disable prettier/prettier */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import ProtectedRoute from '../../components/ProtectedRoute';
import { useTheme } from '../../contexts/ThemeContext';
import { useNotifications } from '../../contexts/NotificationsContext';
import { healthApi } from '../../lib/api';
import config from '../../lib/config';
import { crowdfundApi, CrowdfundProject } from '../../lib/crowdfund';
import { computeFundingProgress } from '../../lib/stellar';

export default function HomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { unreadCount } = useNotifications();
  const [healthStatus, setHealthStatus] = useState<string>('Checking...');
  const [isLoading, setIsLoading] = useState(true);
  const [projects, setProjects] = useState<CrowdfundProject[]>([]);
  const [isProjectsLoading, setIsProjectsLoading] = useState(true);

  useEffect(() => {
    void testApiConnection();
    void fetchFeaturedProjects();
  }, []);

  const testApiConnection = async () => {
    setIsLoading(true);
    const response = await healthApi.check();
    if (response.success && response.data) {
      setHealthStatus(`Connected to ${config.api.baseUrl}`);
    } else {
      setHealthStatus(`Failed: ${response.error?.message || 'Unknown error'}`);
    }
    setIsLoading(false);
  };

  const fetchFeaturedProjects = async () => {
    setIsProjectsLoading(true);
    const response = await crowdfundApi.listProjects();
    if (response.success && response.data) {
      setProjects(response.data.slice(0, 3));
    } else {
      setProjects([]);
    }
    setIsProjectsLoading(false);
  };

  return (
    <ProtectedRoute>
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
      >
        <ExpoStatusBar style={colors.statusBarStyle} />

        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Lumenpulse Mobile</Text>
          <Text style={[styles.subtitle, { color: colors.accent }]}>
            Decentralized Crypto Insights
          </Text>

          <TouchableOpacity
            style={styles.bellButton}
            onPress={() => router.push('/notifications')}
            accessibilityLabel={
              unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
            }
          >
            <Ionicons name="notifications-outline" size={28} color={colors.accent} />
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.comingSoon}>
          <View
            style={[
              styles.glassCard,
              { backgroundColor: colors.card, borderColor: colors.cardBorder },
            ]}
          >
            <Text style={[styles.cardText, { color: colors.text }]}>
              Portfolio &amp; News aggregation coming soon.
            </Text>
          </View>

          <View style={[styles.glassCard, styles.statusCard]}>
            <Text style={styles.statusLabel}>API Status:</Text>
            {isLoading ? (
              <ActivityIndicator color="#7a85ff" style={styles.loader} />
            ) : (
              <Text style={styles.statusText}>{healthStatus}</Text>
            )}
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => void testApiConnection()}
              disabled={isLoading}
            >
              <Text style={styles.retryButtonText}>Test Connection</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.featuredSection}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Featured Projects</Text>
            <TouchableOpacity onPress={() => router.push('/projects')}>
              <Text style={[styles.sectionLink, { color: colors.accent }]}>See all</Text>
            </TouchableOpacity>
          </View>

          {isProjectsLoading ? (
            <ActivityIndicator color={colors.accent} style={styles.projectsLoader} />
          ) : projects.length > 0 ? (
            projects.map((project) => {
              const progress = computeFundingProgress(project.totalDeposited, project.targetAmount);

              return (
                <TouchableOpacity
                  key={project.id}
                  style={[
                    styles.projectCard,
                    { backgroundColor: colors.surface, borderColor: colors.cardBorder },
                  ]}
                  onPress={() => router.push(`/projects/${project.id}`)}
                  activeOpacity={0.85}
                >
                  <View style={styles.projectCardHeader}>
                    <View style={[styles.projectIcon, { backgroundColor: colors.accentSecondary }]}>
                      <Ionicons name="rocket-outline" size={18} color="#ffffff" />
                    </View>
                    <View style={styles.projectCopy}>
                      <Text style={[styles.projectTitle, { color: colors.text }]} numberOfLines={1}>
                        {project.name}
                      </Text>
                      <Text
                        style={[styles.projectSubtitle, { color: colors.textSecondary }]}
                        numberOfLines={2}
                      >
                        Tap to view the full brief, roadmap, and Soroban vault funding progress.
                      </Text>
                    </View>
                  </View>

                  <View style={[styles.projectProgressTrack, { backgroundColor: colors.border }]}>
                    <View
                      style={[
                        styles.projectProgressFill,
                        { width: `${progress}%`, backgroundColor: colors.accent },
                      ]}
                    />
                  </View>

                  <View style={styles.projectCardFooter}>
                    <Text style={[styles.projectMeta, { color: colors.textSecondary }]}>
                      {progress}% funded
                    </Text>
                    <Text style={[styles.projectMeta, { color: colors.textSecondary }]}>
                      {project.contributorCount} backers
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })
          ) : (
            <View
              style={[
                styles.emptyProjects,
                { backgroundColor: colors.card, borderColor: colors.cardBorder },
              ]}
            >
              <Text style={[styles.emptyProjectsText, { color: colors.textSecondary }]}>
                Projects will appear here once the crowdfund feed is available.
              </Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[
            styles.button,
            { backgroundColor: colors.accentSecondary, shadowColor: colors.accentSecondary },
          ]}
        >
          <Text style={styles.buttonText}>Get Started</Text>
        </TouchableOpacity>
      </ScrollView>
    </ProtectedRoute>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: 24,
    paddingVertical: 60,
    paddingBottom: 40,
  },
  header: { marginTop: 40 },
  title: { fontSize: 42, fontWeight: '800', letterSpacing: -1 },
  subtitle: { fontSize: 18, marginTop: 8, fontWeight: '500' },
  bellButton: { position: 'absolute', right: 0, top: 0, padding: 4 },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: '#ff4757',
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  badgeText: { color: '#ffffff', fontSize: 10, fontWeight: '700', lineHeight: 13 },
  comingSoon: { justifyContent: 'center', alignItems: 'center', marginTop: 36 },
  glassCard: { padding: 24, borderRadius: 24, borderWidth: 1, width: '100%' },
  cardText: { fontSize: 16, textAlign: 'center', lineHeight: 24, opacity: 0.8 },
  button: {
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  buttonText: { color: '#ffffff', fontSize: 18, fontWeight: '600' },
  statusCard: { marginTop: 16 },
  statusLabel: { color: '#db74cf', fontSize: 14, fontWeight: '600', marginBottom: 8 },
  statusText: { color: '#ffffff', fontSize: 12, opacity: 0.8, marginBottom: 12 },
  loader: { marginVertical: 12 },
  retryButton: {
    backgroundColor: 'rgba(122, 133, 255, 0.2)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(122, 133, 255, 0.3)',
    alignSelf: 'center',
  },
  retryButtonText: { color: '#7a85ff', fontSize: 12, fontWeight: '600' },
  featuredSection: { marginTop: 28, marginBottom: 28 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  sectionTitle: { fontSize: 22, fontWeight: '700' },
  sectionLink: { fontSize: 14, fontWeight: '700' },
  projectsLoader: { marginVertical: 20 },
  projectCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
  },
  projectCardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  projectIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  projectCopy: { flex: 1 },
  projectTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  projectSubtitle: { fontSize: 13, lineHeight: 19 },
  projectProgressTrack: {
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 10,
  },
  projectProgressFill: { height: '100%', borderRadius: 999 },
  projectCardFooter: { flexDirection: 'row', justifyContent: 'space-between' },
  projectMeta: { fontSize: 12, fontWeight: '600' },
  emptyProjects: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
  },
  emptyProjectsText: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
});
